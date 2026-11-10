-- Paste AFTER the migration, as postgres in SQL Editor. Uses existing real
-- profiles/JWT claims, never touches PINs/auth.users, never commits any data.
-- Raises on failure. Both the savepoint and final ROLLBACK are intentional.
begin;
select pg_advisory_xact_lock(hashtextextended('hr:rollback-tests',0));
create function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.reject(sql text,state text,label text) returns void language plpgsql as $$
declare actual text;
begin
 begin execute sql; exception when others then get stacked diagnostics actual=returned_sqlstate; end;
 if actual is null or actual<>state then raise exception 'FAIL: % (expected %, got %)',label,state,coalesce(actual,'success'); end if;
end $$;
create function pg_temp.command(action text,data jsonb default '{}') returns jsonb language sql as $$
 select public.hr_command(action,data,gen_random_uuid());
$$;
create function pg_temp.login(who uuid) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',who::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',who,'role','authenticated')::text,true);
end $$;
create temp table hr_test_original as select id,to_jsonb(p) row from public.profiles p
 where id in ('8de8a6ef-bb8f-4463-a5c0-0554dbd78751','02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24','2b8cdea2-02e9-4c56-a98f-3351dac3379d');
create temp table hr_test_counts as select
 (select count(*) from public.hr_shifts) shifts,(select count(*) from public.hr_rates) rates,
 (select count(*) from public.hr_payrolls) payrolls,(select count(*) from public.hr_payments) payments,
 (select count(*) from public.hr_audit) audit,(select count(*) from public.hr_commands) commands,
 (select count(*) from public.hr_alerts) alerts,(select count(*) from public.notes) notes;
select pg_temp.assert_true((select count(*)=3 from hr_test_original),'three real profile fixtures exist');
select pg_temp.assert_true((select bool_and(active) and count(*) filter(where role='admin')=1 and count(*) filter(where role='cashier')=2 from public.profiles
 where id in (select id from hr_test_original)),'fixtures are active owner and two cashiers');
select pg_temp.assert_true(not exists(select 1 from public.hr_shifts where employee_id in
 ('02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24','2b8cdea2-02e9-4c56-a98f-3351dac3379d') and (end_at is null or start_at<'2002-01-01 00:00:00+00')),
 'fixtures have no open/historical test shifts; stop rather than alter real attendance');
savepoint attendance_fixtures;

-- Actual callers run with authenticated permissions, including direct RLS reads.
select pg_temp.login('02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24');
set local role authenticated;
select pg_temp.reject($q$select pg_temp.command('convert_staff','{"employee_id":"2b8cdea2-02e9-4c56-a98f-3351dac3379d"}')$q$,'42501','cashier cannot convert another worker');
select pg_temp.reject($q$select pg_temp.command('set_rate','{"employee_id":"02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24","effective_on":"2001-01-01","hourly_rate":60}')$q$,'42501','cashier cannot set own rate');
select pg_temp.reject('select public.hr_reminders()','42501','cashier cannot run reminders');
reset role;
select pg_temp.login('8de8a6ef-bb8f-4463-a5c0-0554dbd78751');
set local role authenticated;
select pg_temp.reject($q$select pg_temp.command('convert_staff','{"employee_id":"8de8a6ef-bb8f-4463-a5c0-0554dbd78751"}')$q$,'22023','admin cannot convert to staff');
select pg_temp.command('convert_staff','{"employee_id":"02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24"}');
select pg_temp.assert_true((select role='staff' and shop_id is null from public.profiles where id='02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24'),'conversion removes ledger shop');
select pg_temp.assert_true(exists(select 1 from public.hr_audit where entity='profiles' and row_id='02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24'
 and before_data->>'role'='cashier' and after_data->>'role'='staff' and before_data->>'shop_id' is not null and after_data->>'shop_id' is null),'conversion audit has original before and after');
reset role;
select pg_temp.login('02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24');
set local role authenticated;
select pg_temp.assert_true(public.hr_active() and not public.is_active_user() and public.my_shop() is null,'staff HR guard is separate from ledger guard');
select pg_temp.assert_true((select count(*)=1 from public.profiles) and (select id=auth.uid() from public.profiles),'loadMe reads own profile only');
select pg_temp.assert_true(not exists(select 1 from public.shops) and not exists(select 1 from public.parties) and not exists(select 1 from public.shop_days),'staff cannot read ledger catalogs or days');
select pg_temp.assert_true((select jsonb_array_length(x->'employees')=1 and x->'employees'->0->>'id'=auth.uid()::text
 and (x->>'server_now')::timestamptz between clock_timestamp()-interval '10 seconds' and clock_timestamp()+interval '10 seconds' from public.hr_snapshot() x),'worker snapshot is self only with server clock');
select pg_temp.reject($q$insert into public.hr_shifts(employee_id) values(auth.uid())$q$,'42501','staff cannot bypass command writes');
select pg_temp.reject($q$update public.hr_rates set hourly_rate=0$q$,'42501','staff cannot directly edit rates');
select pg_temp.reject('select * from public.hr_commands','42501','idempotency records private');
select pg_temp.reject($q$select private.hr_calculate(auth.uid(),current_date,current_date,'[]')$q$,'42501','private calculation not executable');
select pg_temp.reject('select public.hr_reminders()','42501','staff cannot run reminders');
select pg_temp.reject($q$select pg_temp.command('clock_in','{"employee_id":"2b8cdea2-02e9-4c56-a98f-3351dac3379d"}')$q$,'22023','clock target injection rejected');
do $$ declare a jsonb; b jsonb; key uuid:=gen_random_uuid(); begin
 a:=public.hr_command('clock_in','{}',key); b:=public.hr_command('clock_in','{}',key);
 perform pg_temp.assert_true(a=b and (select count(*)=1 from public.hr_shifts where employee_id=auth.uid() and end_at is null),'clock retry returns original with one shift');
 perform set_config('test.clock_id',a->>'id',true);
 perform pg_temp.reject(format('select public.hr_command(%L,%L,%L)','pause','{}',key),'22023','UUID reuse with different action rejected');
 perform pg_temp.reject($q$select pg_temp.command('clock_in')$q$,'22023','second clock in rejected');
 perform pg_temp.reject($q$select pg_temp.command('resume')$q$,'22023','resume requires pause');
 perform pg_temp.command('pause');
 perform pg_temp.reject($q$select pg_temp.command('pause')$q$,'23505','only one open personal pause');
 perform pg_temp.command('resume'); perform pg_temp.command('pause'); perform pg_temp.command('clock_out');
 perform pg_temp.assert_true(not exists(select 1 from public.hr_breaks b join public.hr_shifts s on s.id=b.shift_id where s.employee_id=auth.uid() and b.end_at is null),'clock out closes current personal break');
 perform pg_temp.reject($q$select pg_temp.command('clock_out')$q$,'22023','clock out without shift rejected');
end $$;
reset role;
-- Inactive callers lose RPC and table visibility; restoring is inside rollback.
update public.profiles set active=false where id='02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24';
set local role authenticated;
select pg_temp.reject('select public.hr_snapshot()','42501','inactive snapshot denied');
select pg_temp.reject($q$select pg_temp.command('clock_in')$q$,'42501','inactive command denied');
select pg_temp.assert_true(not exists(select 1 from public.hr_shifts) and not exists(select 1 from public.hr_settings),'inactive HR RLS denies rows');
reset role;
update public.profiles set active=true where id='02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24';

-- Controlled past times are fixture DML as postgres, never client capabilities.
-- A shift crosses midnight and a Cairo effective-rate boundary: 60 + 120,
-- less 15m at each rate => 90 paid minutes, gross 135 (paid ordinary breaks stay).
insert into public.hr_shifts(id,employee_id,start_at,end_at) values
 ('a0000000-0000-0000-0000-000000000001','02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24',timestamp '2001-01-01 23:00' at time zone 'Africa/Cairo',timestamp '2001-01-02 01:00' at time zone 'Africa/Cairo'),
 ('a0000000-0000-0000-0000-000000000002','2b8cdea2-02e9-4c56-a98f-3351dac3379d',timestamp '2001-01-05 10:00' at time zone 'Africa/Cairo',timestamp '2001-01-05 11:00' at time zone 'Africa/Cairo');
insert into public.hr_breaks(shift_id,start_at,end_at) values
 ('a0000000-0000-0000-0000-000000000001',timestamp '2001-01-01 23:45' at time zone 'Africa/Cairo',timestamp '2001-01-02 00:15' at time zone 'Africa/Cairo');
select pg_temp.login('8de8a6ef-bb8f-4463-a5c0-0554dbd78751');
set local role authenticated;
select pg_temp.command('set_rate','{"employee_id":"02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24","effective_on":"2001-01-01","hourly_rate":60}');
select pg_temp.command('set_rate','{"employee_id":"02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24","effective_on":"2001-01-02","hourly_rate":120}');
do $$ declare r jsonb; begin
 r:=pg_temp.command('create_payroll','{"employee_id":"02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24","period_start":"2001-01-01","period_end":"2001-01-02","adjustments":[{"kind":"bonus","amount":10,"reason":"extra"},{"kind":"deduction","amount":2,"reason":"deduction"},{"kind":"advance","amount":3,"reason":"advance"}]}');
 perform pg_temp.assert_true((r->>'work_minutes')::numeric=90 and (r->>'gross')::numeric=135 and (r->>'net')::numeric=140,'cross midnight rates, personal pause and all adjustments');
 perform set_config('test.payroll',r->>'id',true);
 r:=pg_temp.command('create_payroll','{"employee_id":"02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24","period_start":"2001-01-02","period_end":"2001-01-02"}');
 perform pg_temp.assert_true((r->>'work_minutes')::numeric=45 and (r->>'gross')::numeric=90,'inclusive Cairo range clips shift and cross-midnight break');
 perform set_config('test.overlap',r->>'id',true);
 perform pg_temp.reject($q$select pg_temp.command('record_payment',jsonb_build_object('payroll_id',current_setting('test.payroll'),'amount',1,'paid_on','2001-01-03'))$q$,'22023','draft cannot receive payment');
 r:=pg_temp.command('create_payroll','{"employee_id":"2b8cdea2-02e9-4c56-a98f-3351dac3379d","period_start":"2001-01-05","period_end":"2001-01-05"}');
 perform set_config('test.missing',r->>'id',true);
 perform pg_temp.reject($q$select pg_temp.command('approve_payroll',jsonb_build_object('payroll_id',current_setting('test.missing')))$q$,'22023','missing rate blocks approval for actual work');
 perform pg_temp.command('set_rate','{"employee_id":"2b8cdea2-02e9-4c56-a98f-3351dac3379d","effective_on":"2001-01-01","hourly_rate":10}');
 r:=pg_temp.command('approve_payroll',jsonb_build_object('payroll_id',current_setting('test.missing')));
 perform pg_temp.assert_true((r->>'gross')::numeric=10 and (r->>'work_minutes')::numeric=60,'approval recomputes a formerly missing-rate draft');
 r:=pg_temp.command('create_payroll',jsonb_build_object('employee_id','2b8cdea2-02e9-4c56-a98f-3351dac3379d','period_start',(clock_timestamp() at time zone 'Africa/Cairo')::date,'period_end',(clock_timestamp() at time zone 'Africa/Cairo')::date));
 perform set_config('test.today',r->>'id',true);
 perform pg_temp.reject($q$select pg_temp.command('approve_payroll',jsonb_build_object('payroll_id',current_setting('test.today')))$q$,'22023','today cannot freeze future work');
 r:=pg_temp.command('create_payroll',jsonb_build_object('employee_id','2b8cdea2-02e9-4c56-a98f-3351dac3379d','period_start',(clock_timestamp() at time zone 'Africa/Cairo')::date+1,'period_end',(clock_timestamp() at time zone 'Africa/Cairo')::date+2));
 perform set_config('test.future',r->>'id',true);
 perform pg_temp.reject($q$select pg_temp.command('approve_payroll',jsonb_build_object('payroll_id',current_setting('test.future')))$q$,'22023','future dates cannot be approved');
 perform pg_temp.reject($q$select pg_temp.command('create_payroll','{"employee_id":"02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24","period_start":"2001-01-01","period_end":"2001-01-02","adjustments":[{"kind":"fake","amount":1,"reason":"x"}]}')$q$,'22023','unknown adjustment rejected');
 perform pg_temp.reject($q$select pg_temp.command('create_payroll','{"employee_id":"02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24","period_start":"2001-01-01","period_end":"2001-01-02","adjustments":[{"kind":"bonus","amount":-1,"reason":"x"}]}')$q$,'22023','negative adjustment rejected');
end $$;
reset role;

-- Pending correction blocks approval, review changes original shift, draft
-- recomputes. Ownership and snapshot/table RLS checked as the worker.
select pg_temp.login('02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24');
set local role authenticated;
select pg_temp.reject($q$select pg_temp.command('correct','{"shift_id":"a0000000-0000-0000-0000-000000000002","end_at":"2001-01-05T12:00:00+02:00","reason":"x"}')$q$,'42501','cannot correct another worker');
do $$ declare r jsonb; begin
 r:=pg_temp.command('correct',jsonb_build_object('shift_id','a0000000-0000-0000-0000-000000000001','end_at',timestamp '2001-01-02 01:30' at time zone 'Africa/Cairo','reason','forgot end'));
 perform set_config('test.correction',r->>'id',true);
 perform pg_temp.assert_true(not exists(select 1 from public.hr_rates where employee_id<>auth.uid()) and not exists(select 1 from public.hr_shifts where employee_id<>auth.uid())
 and not exists(select 1 from public.hr_payrolls where employee_id<>auth.uid()) and not exists(select 1 from public.hr_requests where employee_id<>auth.uid()),'worker direct RLS is self only');
 perform pg_temp.assert_true((select bool_and(v->>'employee_id'=auth.uid()::text) from jsonb_array_elements(public.hr_snapshot()->'payrolls') v),'worker snapshot excludes other payrolls');
 perform pg_temp.reject($q$select pg_temp.command('approve_correction',jsonb_build_object('request_id',current_setting('test.correction'),'approve',true,'reason','own'))$q$,'42501','worker cannot review correction');
 perform pg_temp.reject($q$select pg_temp.command('approve_payroll',jsonb_build_object('payroll_id',current_setting('test.payroll')))$q$,'42501','worker cannot approve payroll');
end $$;
reset role;
select pg_temp.login('8de8a6ef-bb8f-4463-a5c0-0554dbd78751');
set local role authenticated;
select pg_temp.reject($q$select pg_temp.command('approve_payroll',jsonb_build_object('payroll_id',current_setting('test.payroll')))$q$,'22023','pending correction blocks approval');
select pg_temp.command('approve_correction',jsonb_build_object('request_id',current_setting('test.correction'),'approve',true,'reason','checked'));
do $$ declare r jsonb; first_payment jsonb; key uuid:=gen_random_uuid(); before_audit bigint; begin
 r:=pg_temp.command('approve_payroll',jsonb_build_object('payroll_id',current_setting('test.payroll')));
 perform pg_temp.assert_true((r->>'work_minutes')::numeric=120 and (r->>'gross')::numeric=195 and (r->>'net')::numeric=200 and r->>'status'='approved','approval recomputes corrected draft with original adjustments');
 perform set_config('test.frozen',r::text,true);
 perform pg_temp.reject($q$select pg_temp.command('approve_payroll',jsonb_build_object('payroll_id',current_setting('test.overlap')))$q$,'22023','inclusive approved date ranges cannot overlap');
 perform pg_temp.reject($q$select pg_temp.command('set_rate','{"employee_id":"02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24","effective_on":"2001-01-01","hourly_rate":999}')$q$,'22023','cannot modify rate inside approved period');
 perform pg_temp.reject($q$select pg_temp.command('set_rate','{"employee_id":"2b8cdea2-02e9-4c56-a98f-3351dac3379d","effective_on":"2001-01-04","hourly_rate":999}')$q$,'22023','earlier effective rate cannot affect approved day');
 -- Jan 3 rate is outside the frozen interval, must remain editable.
 perform pg_temp.command('set_rate','{"employee_id":"02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24","effective_on":"2001-01-03","hourly_rate":80}');
 select count(*) into before_audit from public.hr_audit;
 first_payment:=public.hr_command('record_payment',jsonb_build_object('payroll_id',current_setting('test.payroll'),'amount',75,'paid_on','2001-01-03','note','part 1'),key);
 r:=public.hr_command('record_payment',jsonb_build_object('payroll_id',current_setting('test.payroll'),'amount',75,'paid_on','2001-01-03','note','part 1'),key);
 perform pg_temp.assert_true(r=first_payment and (select count(*)=1 and sum(amount)=75 from public.hr_payments where payroll_id=current_setting('test.payroll')::uuid),'payment retry inserts exactly once');
 perform pg_temp.assert_true((select count(*)=before_audit+1 from public.hr_audit),'idempotent payment retry appends no duplicate audit');
 perform pg_temp.command('record_payment',jsonb_build_object('payroll_id',current_setting('test.payroll'),'amount',125,'paid_on','2001-01-04','note','balance'));
 perform pg_temp.reject($q$select pg_temp.command('record_payment',jsonb_build_object('payroll_id',current_setting('test.payroll'),'amount',0.01,'paid_on','2001-01-04'))$q$,'22023','payments cannot exceed net');
 perform pg_temp.reject($q$select pg_temp.command('record_payment',jsonb_build_object('payroll_id',current_setting('test.payroll'),'amount',0,'paid_on','2001-01-04'))$q$,'22023','zero payment rejected');
 perform pg_temp.reject($q$select pg_temp.command('record_payment',jsonb_build_object('payroll_id',current_setting('test.payroll'),'amount',1,'paid_on','2999-01-01'))$q$,'22023','future payment date rejected');
 perform pg_temp.assert_true((select to_jsonb(p)=current_setting('test.frozen')::jsonb from public.hr_payrolls p where id=current_setting('test.payroll')::uuid),'approved payroll and snapshot remain frozen after rate/payment writes');
 perform pg_temp.assert_true(exists(select 1 from public.hr_audit where entity='hr_shifts' and row_id='a0000000-0000-0000-0000-000000000001'
 and before_data->>'end_at'<>after_data->>'end_at' and request_id is not null),'correction audit preserves original shift');
 perform pg_temp.reject('update public.hr_audit set before_data=null','42501','authenticated admin cannot change audit');
 perform pg_temp.reject('delete from public.hr_payments','42501','authenticated admin cannot delete payments');
end $$;
reset role;
select pg_temp.login('02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24');
set local role authenticated;
select pg_temp.reject($q$select pg_temp.command('correct',jsonb_build_object('shift_id','a0000000-0000-0000-0000-000000000001','end_at',timestamp '2001-01-02 02:00' at time zone 'Africa/Cairo','reason','later'))$q$,'22023','approved work cannot be corrected');
reset role;

-- Open shift blocks approval; reminders are once per shift and server timed.
insert into public.hr_shifts(id,employee_id,start_at) values
 ('a0000000-0000-0000-0000-000000000003','2b8cdea2-02e9-4c56-a98f-3351dac3379d',timestamp '2001-01-06 10:00' at time zone 'Africa/Cairo');
select pg_temp.login('8de8a6ef-bb8f-4463-a5c0-0554dbd78751');
set local role authenticated;
select pg_temp.reject($q$select pg_temp.command('convert_staff','{"employee_id":"2b8cdea2-02e9-4c56-a98f-3351dac3379d"}')$q$,'22023','open shift blocks staff conversion');
do $$ declare r jsonb; begin
 r:=pg_temp.command('create_payroll','{"employee_id":"2b8cdea2-02e9-4c56-a98f-3351dac3379d","period_start":"2001-01-06","period_end":"2001-01-06"}');
 perform set_config('test.open',r->>'id',true);
 perform pg_temp.reject($q$select pg_temp.command('approve_payroll',jsonb_build_object('payroll_id',current_setting('test.open')))$q$,'22023','open intersecting shift blocks approval');
end $$;
select pg_temp.command('set_settings','{"reminder_hours":12}');
select pg_temp.reject($q$select pg_temp.command('set_settings','{"reminder_hours":0}')$q$,'23514','reminder threshold must be positive');
reset role;
select pg_temp.login('2b8cdea2-02e9-4c56-a98f-3351dac3379d');
do $$ declare n bigint; emitted integer; begin
 select count(*) into n from public.notes;
 emitted:=public.hr_reminders();
 perform pg_temp.assert_true(public.hr_reminders()=0,'second reminder run emits no duplicates');
 perform pg_temp.assert_true((select count(*)=1 from public.hr_alerts where shift_id='a0000000-0000-0000-0000-000000000003'),'repeated reminder runs emit once per shift');
 perform pg_temp.assert_true((select count(*)=n+emitted from public.notes),'one owner notification per emitted reminder');
 perform pg_temp.assert_true(exists(select 1 from public.hr_alerts where employee_id='2b8cdea2-02e9-4c56-a98f-3351dac3379d'),'employee reminder stored');
end $$;
-- Internal audit is append only even when mistakenly called as owner.
select pg_temp.reject('update public.hr_audit set before_data=null','42501','audit append-only trigger also protects owner');
-- Regression: a pause closed by a late checkout must be repairable. Pauses
-- spanning the corrected end are clipped; wholly later pauses are audited away.
insert into public.hr_shifts(id,employee_id,start_at,end_at) values
 ('a0000000-0000-0000-0000-000000000004','02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24',timestamp '2001-01-10 08:00' at time zone 'Africa/Cairo',timestamp '2001-01-10 20:00' at time zone 'Africa/Cairo'),
 ('a0000000-0000-0000-0000-000000000005','02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24',timestamp '2001-01-11 08:00' at time zone 'Africa/Cairo',timestamp '2001-01-11 20:00' at time zone 'Africa/Cairo');
insert into public.hr_breaks(id,shift_id,start_at,end_at) values
 ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000004',timestamp '2001-01-10 12:00' at time zone 'Africa/Cairo',timestamp '2001-01-10 20:00' at time zone 'Africa/Cairo'),
 ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000005',timestamp '2001-01-11 17:00' at time zone 'Africa/Cairo',timestamp '2001-01-11 20:00' at time zone 'Africa/Cairo');
select pg_temp.login('02b9e971-7fe7-4d8e-8276-c8fb6b0f8d24');
set local role authenticated;
do $$ declare r jsonb; begin
 r:=pg_temp.command('correct',jsonb_build_object('shift_id','a0000000-0000-0000-0000-000000000004','end_at',timestamp '2001-01-10 16:00' at time zone 'Africa/Cairo','reason','late checkout with pause'));
 perform set_config('test.clip',r->>'id',true);
 r:=pg_temp.command('correct',jsonb_build_object('shift_id','a0000000-0000-0000-0000-000000000005','end_at',timestamp '2001-01-11 16:00' at time zone 'Africa/Cairo','reason','pause after actual checkout'));
 perform set_config('test.remove',r->>'id',true);
end $$;
reset role;
select pg_temp.login('8de8a6ef-bb8f-4463-a5c0-0554dbd78751');
set local role authenticated;
select pg_temp.command('approve_correction',jsonb_build_object('request_id',current_setting('test.clip'),'approve',true,'reason','verified'));
select pg_temp.command('approve_correction',jsonb_build_object('request_id',current_setting('test.remove'),'approve',true,'reason','verified'));
select pg_temp.assert_true((select end_at=timestamp '2001-01-10 16:00' at time zone 'Africa/Cairo' from public.hr_breaks where id='b0000000-0000-0000-0000-000000000001'),'late checkout correction clips personal break');
select pg_temp.assert_true(not exists(select 1 from public.hr_breaks where id='b0000000-0000-0000-0000-000000000002'),'entirely later personal break removed');
select pg_temp.assert_true(exists(select 1 from public.hr_audit where entity='hr_breaks' and row_id='b0000000-0000-0000-0000-000000000001'
 and (before_data->>'end_at')::timestamptz=timestamp '2001-01-10 20:00' at time zone 'Africa/Cairo'
 and (after_data->>'end_at')::timestamptz=timestamp '2001-01-10 16:00' at time zone 'Africa/Cairo'),'clipped break audit retains before and after');
select pg_temp.assert_true(exists(select 1 from public.hr_audit where entity='hr_breaks' and row_id='b0000000-0000-0000-0000-000000000002' and before_data is not null and after_data is null),'removed break audit retains original');
reset role;
set local role anon;
select pg_temp.reject('select public.hr_snapshot()','42501','anonymous snapshot denied');
select pg_temp.reject($q$select public.hr_command('clock_in','{}',gen_random_uuid())$q$,'42501','anonymous command denied');
select pg_temp.reject('select public.hr_reminders()','42501','anonymous reminders denied');
select pg_temp.reject('select * from public.hr_payrolls','42501','anonymous HR table access denied');
reset role;
-- All custom SECURITY DEFINER routines must pin an empty search path.
select pg_temp.assert_true(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.proname like 'hr_%' and p.prosecdef
 and not coalesce(p.proconfig @> array['search_path=""'],false)),'HR definer functions have an empty search_path');
select pg_temp.assert_true(not exists(select 1 from pg_publication where pubname='supabase_realtime') or
 (select count(*)=8 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'
 and tablename in ('hr_settings','hr_rates','hr_shifts','hr_breaks','hr_requests','hr_payrolls','hr_payments','hr_alerts')),'all UI HR tables join existing Realtime publication');
select pg_temp.assert_true(not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename in ('hr_audit','hr_commands')),'audit/idempotency excluded from Realtime');

rollback to savepoint attendance_fixtures;
select pg_temp.assert_true(not exists(select 1 from hr_test_original o join public.profiles p using(id) where o.row<>to_jsonb(p)),'all original profile records restored');
select pg_temp.assert_true((select
 shifts=(select count(*) from public.hr_shifts) and rates=(select count(*) from public.hr_rates)
 and payrolls=(select count(*) from public.hr_payrolls) and payments=(select count(*) from public.hr_payments)
 and audit=(select count(*) from public.hr_audit) and commands=(select count(*) from public.hr_commands)
 and alerts=(select count(*) from public.hr_alerts) and notes=(select count(*) from public.notes)
 from hr_test_counts),'rollback restores HR, audit, idempotency and owner note counts');
rollback;
