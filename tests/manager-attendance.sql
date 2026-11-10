-- Run through execute_sql after migration. No PINs or auth records touched.
-- All fixture mutations, audit and commands are rolled back.
begin;
do $test$
declare u uuid; emp uuid; r jsonb; updated jsonb; payload jsonb; snapshot jsonb; p uuid;
 key uuid:=gen_random_uuid(); n bigint; failed boolean;
begin
 select id into u from public.profiles where role='admin' and active order by id limit 1;
 select id into emp from public.profiles where role in ('staff','cashier') and active order by id limit 1;
 if u is null or emp is null then raise exception 'Test fixtures unavailable';end if;
 select count(*) into n from public.hr_shifts where employee_id=emp and start_at<'2002-01-01';
 if n<>0 then raise exception 'Historical test range occupied; stop without changing real attendance';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 payload:=jsonb_build_object('employee_id',emp,'start_at','2001-01-01T20:00:00Z','end_at','2001-01-02T04:00:00Z','breaks',jsonb_build_array(jsonb_build_object('start_at','2001-01-01T23:00:00Z','end_at','2001-01-01T23:30:00Z')),'reason','ROLLBACK TEST: historical overnight shift');
 r:=public.hr_command('admin_add_shift',payload,key);
 if r is distinct from public.hr_command('admin_add_shift',payload,key) then raise exception 'Retry identity failed';end if;
 if not exists(select 1 from public.hr_audit where row_id=r->>'id' and after_data->>'change_reason'=payload->>'reason' and actor_id=u) then raise exception 'Missing audit reason/actor';end if;
 if not exists(select 1 from public.hr_breaks where shift_id=(r->>'id')::uuid) then raise exception 'Missing break';end if;
 -- Non-admin cannot use the entry point, regardless of a forged target employee.
 perform set_config('request.jwt.claim.sub',emp::text,true);
 failed:=false;begin perform public.hr_command('admin_add_shift',payload,gen_random_uuid());exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'Employee manually changed attendance';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 failed:=false;begin perform public.hr_command('admin_add_shift',payload,gen_random_uuid());exception when sqlstate '22023' then failed:=sqlerrm='Shift overlap';end;
 if not failed then raise exception 'Shift overlap not blocked';end if;
 select jsonb_build_object('shift',to_jsonb(s),'breaks',(select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]') from public.hr_breaks b where b.shift_id=s.id)) into snapshot from public.hr_shifts s where id=(r->>'id')::uuid;
 payload:=jsonb_build_object('shift_id',r->>'id','expected_snapshot',snapshot,'start_at','2001-01-01T19:00:00Z','end_at','2001-01-02T04:00:00Z','breaks',snapshot->'breaks','reason','ROLLBACK TEST: corrected start');
 updated:=public.hr_command('admin_update_shift',payload,gen_random_uuid());
 if (updated->>'start_at')::timestamptz<>'2001-01-01T19:00:00Z'::timestamptz then raise exception 'Start correction failed';end if;
 failed:=false;begin perform public.hr_command('admin_update_shift',payload,gen_random_uuid());exception when sqlstate '22023' then failed:=sqlerrm like 'Shift changed%';end;
 if not failed then raise exception 'Stale write not blocked';end if;
 snapshot:=jsonb_set(snapshot,'{shift}',updated);
 payload:=jsonb_set(payload,'{expected_snapshot}',snapshot);
 payload:=jsonb_set(payload,'{breaks}','[{"start_at":"2001-01-01T18:00:00Z","end_at":"2001-01-01T18:30:00Z"}]');
 failed:=false;begin perform public.hr_command('admin_update_shift',payload,gen_random_uuid());exception when sqlstate '22023' then failed:=sqlerrm like 'Personal pause%';end;
 if not failed then raise exception 'Out-of-shift personal exit not blocked';end if;
 payload:=jsonb_set(payload,'{breaks}',snapshot->'breaks');
 insert into public.hr_requests(employee_id,shift_id,requested_end,reason) values(emp,(r->>'id')::uuid,'2001-01-02T05:00:00Z','ROLLBACK TEST');
 failed:=false;begin perform public.hr_command('admin_update_shift',payload,gen_random_uuid());exception when sqlstate '22023' then failed:=sqlerrm like 'Review pending%';end;
 if not failed then raise exception 'Pending correction not blocked';end if;
 update public.hr_requests set status='rejected',review_note='ROLLBACK TEST' where shift_id=(r->>'id')::uuid and status='pending';
 -- A closed shift with unpaid pause is calculated normally across Cairo dates.
 perform public.hr_command('set_rate',jsonb_build_object('employee_id',emp,'effective_on','2001-01-01','hourly_rate',60),gen_random_uuid());
 if (private.hr_calculate(emp,'2001-01-01','2001-01-02','[]')->>'gross')::numeric<>510 then raise exception 'Historical wage calculation failed';end if;
 r:=public.hr_command('create_payroll',jsonb_build_object('employee_id',emp,'period_start','2001-01-01','period_end','2001-01-02'),gen_random_uuid());p:=(r->>'id')::uuid;
 perform public.hr_command('approve_payroll',jsonb_build_object('payroll_id',p),gen_random_uuid());
 failed:=false;begin perform public.hr_command('admin_update_shift',payload,gen_random_uuid());exception when sqlstate '22023' then failed:=sqlerrm like '%approved payroll%';end;
 if not failed then raise exception 'Approved payroll not protected';end if;
end $test$;
rollback;
