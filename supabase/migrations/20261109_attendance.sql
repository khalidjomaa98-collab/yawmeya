-- Attendance is independent of shops/ledger days. Personal pauses are unpaid;
-- ordinary breaks need no command and remain paid. No auth/PIN records change.
begin;
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','cashier','staff'));
alter table public.profiles add constraint profiles_staff_shop_check check (role <> 'staff' or shop_id is null);
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role in ('admin','cashier'));
$$;
create policy profiles_self on public.profiles for select to authenticated using (id=auth.uid());

create table public.hr_settings (
 singleton boolean primary key default true check(singleton),
 reminder_hours numeric not null default 12 check(reminder_hours>0 and reminder_hours<8760)
);
insert into public.hr_settings default values;
create table public.hr_rates (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles(id),
 effective_on date not null check(isfinite(effective_on)),
 hourly_rate numeric not null check(hourly_rate>=0 and hourly_rate<'Infinity'::numeric),
 unique(employee_id,effective_on)
);
create table public.hr_shifts (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles(id),
 start_at timestamptz not null default clock_timestamp() check(isfinite(start_at)),
 end_at timestamptz check(isfinite(end_at) and end_at>start_at)
);
create unique index hr_one_open_shift on public.hr_shifts(employee_id) where end_at is null;
create index hr_shifts_employee on public.hr_shifts(employee_id,start_at);
create table public.hr_breaks (
 id uuid primary key default gen_random_uuid(), shift_id uuid not null references public.hr_shifts(id),
 start_at timestamptz not null default clock_timestamp() check(isfinite(start_at)),
 end_at timestamptz check(isfinite(end_at) and end_at>=start_at)
);
create unique index hr_one_open_break on public.hr_breaks(shift_id) where end_at is null;
create index hr_breaks_shift on public.hr_breaks(shift_id);
create table public.hr_requests (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles(id),
 shift_id uuid not null references public.hr_shifts(id), requested_end timestamptz not null check(isfinite(requested_end)),
 reason text not null check(length(btrim(reason))>0),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 review_note text
);
create unique index hr_one_pending_request on public.hr_requests(shift_id) where status='pending';
create table public.hr_payrolls (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles(id),
 period_start date not null check(isfinite(period_start)), period_end date not null check(isfinite(period_end)),
 status text not null default 'draft' check(status in ('draft','approved')),
 work_minutes numeric not null, gross numeric not null, adjustments jsonb not null default '[]', net numeric not null check(net>=0),
 snapshot jsonb not null, approved_at timestamptz,
 check(period_end>=period_start), check((status='approved')=(approved_at is not null))
);
create index hr_payrolls_employee on public.hr_payrolls(employee_id,period_start,period_end);
create table public.hr_payments (
 id uuid primary key default gen_random_uuid(), payroll_id uuid not null references public.hr_payrolls(id),
 amount numeric not null check(amount>0 and amount<'Infinity'::numeric and amount=round(amount,2)),
 paid_on date not null check(isfinite(paid_on)), note text not null default ''
);
create index hr_payments_payroll on public.hr_payments(payroll_id);
create table public.hr_alerts (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles(id),
 shift_id uuid not null unique references public.hr_shifts(id), text text not null,
 created_at timestamptz not null default clock_timestamp()
);
create table public.hr_commands (
 actor_id uuid not null references public.profiles(id), request_id uuid not null,
 action text not null, payload jsonb not null, response jsonb not null,
 primary key(actor_id,request_id)
);
create table public.hr_audit (
 id uuid primary key default gen_random_uuid(), actor_id uuid, request_id uuid,
 entity text not null, row_id text not null, before_data jsonb, after_data jsonb,
 created_at timestamptz not null default clock_timestamp()
);

create function public.hr_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active);
$$;
create function public.hr_visible(p_employee uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.hr_active() and (public.is_admin() or p_employee=auth.uid());
$$;
create function private.hr_audit_row() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.hr_audit(actor_id,request_id,entity,row_id,before_data,after_data)
 values(auth.uid(),nullif(current_setting('hr.request_id',true),'')::uuid,tg_table_name,
 coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id','settings'),
 case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);
 return null;
end $$;
create function private.hr_append_only() returns trigger language plpgsql security definer set search_path='' as $$
begin raise exception 'HR audit is append only' using errcode='42501'; end $$;
create trigger hr_audit_immutable before update or delete on public.hr_audit for each row execute function private.hr_append_only();
do $$ declare t text; begin
 foreach t in array array['settings','rates','shifts','breaks','requests','payrolls','payments','alerts','commands','audit'] loop
  execute format('alter table public.hr_%I enable row level security',t);
  execute format('revoke all on public.hr_%I from public, anon, authenticated',t);
  if t<>'commands' then
   execute format('grant select on public.hr_%I to authenticated',t);
  end if;
  if t not in ('commands','audit') then
   execute format('create trigger hr_audit after insert or update or delete on public.hr_%I for each row execute function private.hr_audit_row()',t);
  end if;
 end loop;
end $$;
create policy hr_settings_read on public.hr_settings for select to authenticated using(public.hr_active());
create policy hr_rates_read on public.hr_rates for select to authenticated using(public.hr_visible(employee_id));
create policy hr_shifts_read on public.hr_shifts for select to authenticated using(public.hr_visible(employee_id));
create policy hr_breaks_read on public.hr_breaks for select to authenticated using(exists(select 1 from public.hr_shifts s where s.id=shift_id and public.hr_visible(s.employee_id)));
create policy hr_requests_read on public.hr_requests for select to authenticated using(public.hr_visible(employee_id));
create policy hr_payrolls_read on public.hr_payrolls for select to authenticated using(public.hr_visible(employee_id));
create policy hr_payments_read on public.hr_payments for select to authenticated using(exists(select 1 from public.hr_payrolls p where p.id=payroll_id and public.hr_visible(p.employee_id)));
create policy hr_alerts_read on public.hr_alerts for select to authenticated using(public.hr_visible(employee_id));
create policy hr_audit_read on public.hr_audit for select to authenticated using(public.hr_active() and public.is_admin());

-- Return draft diagnostics too; only approval requires readiness. Split on Cairo
-- civil midnights (DST days may have 23/25 actual hours), retain fractional minutes.
create function private.hr_calculate(e uuid,lo date,hi date,adj jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare x jsonb; delta numeric:=0; secs numeric; mins numeric:=0; raw_gross numeric:=0;
 missing boolean:=false; segments jsonb:='[]'; r record; result jsonb;
begin
 if lo is null or hi is null or not isfinite(lo) or not isfinite(hi) or hi<lo then
  raise exception 'Invalid payroll dates' using errcode='22023';
 end if;
 if adj is null or jsonb_typeof(adj)<>'array' then raise exception 'Adjustments must be an array' using errcode='22023'; end if;
 for x in select value from jsonb_array_elements(adj) loop
  if jsonb_typeof(x)<>'object' or coalesce(x->>'kind','') not in ('bonus','deduction','advance')
   or jsonb_typeof(x->'amount') is distinct from 'number' or coalesce(btrim(x->>'reason'),'')=''
   or (x->>'amount')::numeric<0 or (x->>'amount')::numeric>='Infinity'::numeric then
   raise exception 'Invalid adjustment' using errcode='22023';
  end if;
  delta:=delta+(case when x->>'kind'='bonus' then 1 else -1 end)*(x->>'amount')::numeric;
 end loop;
 for r in
  select s.id, d::date AS day, greatest(s.start_at,d at time zone 'Africa/Cairo') a,
   least(coalesce(s.end_at,clock_timestamp()),(d+interval '1 day') at time zone 'Africa/Cairo') b,
   rate.id rate_id,rate.hourly_rate
  from public.hr_shifts s
  cross join lateral generate_series(
   greatest(lo,(s.start_at at time zone 'Africa/Cairo')::date)::timestamp,
   least(hi,(coalesce(s.end_at,clock_timestamp()) at time zone 'Africa/Cairo')::date)::timestamp,interval '1 day') d
  left join lateral (select id,hourly_rate from public.hr_rates where employee_id=e and effective_on<=d::date order by effective_on desc limit 1) rate on true
  where s.employee_id=e and s.start_at<((hi+1)::timestamp at time zone 'Africa/Cairo')
   and coalesce(s.end_at,'infinity')>(lo::timestamp at time zone 'Africa/Cairo')
  order by s.start_at,d
 loop
  secs:=extract(epoch from (r.b-r.a));
  secs:=secs-coalesce((select sum(extract(epoch from least(coalesce(b.end_at,r.b),r.b)-greatest(b.start_at,r.a)))
   from public.hr_breaks b where b.shift_id=r.id and b.start_at<r.b and coalesce(b.end_at,r.b)>r.a),0);
  if secs>0 then
   missing:=missing or r.hourly_rate is null;
   mins:=mins+secs/60; raw_gross:=raw_gross+secs*coalesce(r.hourly_rate,0)/3600;
   segments:=segments||jsonb_build_array(jsonb_build_object('shift_id',r.id,'day',r.day,'start_at',r.a,'end_at',r.b,'work_minutes',secs/60,'rate_id',r.rate_id,'hourly_rate',r.hourly_rate));
  end if;
 end loop;
 result:=jsonb_build_object('work_minutes',mins,'gross',round(raw_gross,2),'adjustments',adj,'net',round(raw_gross+delta,2),
 'segments',segments,'missing_rates',missing,
 'open_shifts',exists(select 1 from public.hr_shifts s where s.employee_id=e and s.end_at is null and s.start_at<((hi+1)::timestamp at time zone 'Africa/Cairo')),
 'pending_corrections',exists(select 1 from public.hr_requests q join public.hr_shifts s on s.id=q.shift_id
  where q.employee_id=e and q.status='pending' and s.start_at<((hi+1)::timestamp at time zone 'Africa/Cairo')
  and greatest(coalesce(s.end_at,'infinity'),q.requested_end)>(lo::timestamp at time zone 'Africa/Cairo')));
 if (result->>'net')::numeric<0 then raise exception 'Net pay cannot be negative' using errcode='22023'; end if;
 return result;
end $$;

create function public.hr_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; t text; rows jsonb;
begin
 if not public.hr_active() then raise exception 'Active HR user required' using errcode='42501'; end if;
 result:=jsonb_build_object('server_now',clock_timestamp(),'settings',(select to_jsonb(s)-'singleton' from public.hr_settings s),
 'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role,'active',active) order by name,id),'[]') from public.profiles where public.hr_visible(id)));
 foreach t in array array['rates','shifts','requests','payrolls','alerts'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by x.id),''[]'') from public.hr_%I x where public.hr_visible(x.employee_id)',t) into rows;
  result:=result||jsonb_build_object(t,rows);
 end loop;
 return result||jsonb_build_object(
 'breaks',(select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]') from public.hr_breaks b join public.hr_shifts s on s.id=b.shift_id where public.hr_visible(s.employee_id)),
 'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.hr_payments p join public.hr_payrolls s on s.id=p.payroll_id where public.hr_visible(s.employee_id)),
 'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),'[]') from public.hr_audit a where public.is_admin()));
end $$;

create function public.hr_command(p_action text,p_data jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); e uuid; admin boolean; s public.hr_shifts; q public.hr_requests;
 p public.hr_payrolls; prior public.hr_commands; result jsonb; calc jsonb; original jsonb;
 v_now timestamptz:=clock_timestamp(); v_end timestamptz; v_date date; next_date date;
 amount numeric; target uuid;
begin
 perform 1 from public.profiles where id=u and active;
 if not found then raise exception 'Active HR user required' using errcode='42501'; end if;
 admin:=public.is_admin();
 if p_request_id is null or p_action is null or p_data is null or jsonb_typeof(p_data)<>'object' then
  raise exception 'Action, object payload and request UUID required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('hr:request:'||u::text||':'||p_request_id::text,0));
 select * into prior from public.hr_commands where actor_id=u and request_id=p_request_id;
 if found then
  if prior.action<>p_action or prior.payload<>p_data then raise exception 'Request UUID already used with different input' using errcode='22023'; end if;
  return prior.response;
 end if;
 if p_action not in ('clock_in','clock_out','pause','resume','correct','approve_correction','set_rate','set_settings','convert_staff','create_payroll','approve_payroll','record_payment') then
  raise exception 'Unknown HR action' using errcode='22023'; end if;
 if p_action in ('clock_in','clock_out','pause','resume') and p_data<>'{}'::jsonb then
  raise exception 'Clock commands take an empty object' using errcode='22023'; end if;
 if p_action not in ('clock_in','clock_out','pause','resume','correct') and not admin then
  raise exception 'Admin required' using errcode='42501'; end if;
 e:=u;
 if p_action in ('set_rate','convert_staff','create_payroll') then e:=(p_data->>'employee_id')::uuid;
 elsif p_action='correct' then select employee_id into e from public.hr_shifts where id=(p_data->>'shift_id')::uuid;
 elsif p_action='approve_correction' then select employee_id into e from public.hr_requests where id=(p_data->>'request_id')::uuid;
 elsif p_action in ('approve_payroll','record_payment') then select employee_id into e from public.hr_payrolls where id=(p_data->>'payroll_id')::uuid;
 end if;
 if e is null or not exists(select 1 from public.profiles where id=e) then raise exception 'Employee or record not found' using errcode='22023'; end if;
 if not admin and e<>u then raise exception 'Own shifts only' using errcode='42501'; end if;
 -- Every write affecting one employee shares this lock, including corrections,
 -- rates, approvals and payments. This closes approval/payment/rate races.
 perform pg_advisory_xact_lock(hashtextextended('hr:employee:'||e::text,0));
 v_now:=clock_timestamp();
 perform set_config('hr.request_id',p_request_id::text,true);
 if p_action in ('clock_in','clock_out','pause','resume') then
  select * into s from public.hr_shifts where employee_id=u and end_at is null for update;
  if p_action='clock_in' then
   if found then raise exception 'Shift already open' using errcode='22023'; end if;
   insert into public.hr_shifts(employee_id,start_at) values(u,v_now) returning to_jsonb(hr_shifts) into result;
  else
   if not found then raise exception 'No open shift' using errcode='22023'; end if;
   if p_action='pause' then
    insert into public.hr_breaks(shift_id,start_at) values(s.id,v_now) returning to_jsonb(hr_breaks) into result;
   elsif p_action='resume' then
    update public.hr_breaks set end_at=v_now where shift_id=s.id and end_at is null returning to_jsonb(hr_breaks) into result;
    if not found then raise exception 'No personal pause open' using errcode='22023'; end if;
   else
    update public.hr_breaks set end_at=v_now where shift_id=s.id and end_at is null;
    update public.hr_shifts set end_at=v_now where id=s.id returning to_jsonb(hr_shifts) into result;
   end if;
  end if;
 elsif p_action in ('correct','approve_correction') then
  if p_action='correct' then
   select * into s from public.hr_shifts where id=(p_data->>'shift_id')::uuid for update;
   v_end:=(p_data->>'end_at')::timestamptz;
  else
   select * into q from public.hr_requests where id=(p_data->>'request_id')::uuid for update;
   if q.status<>'pending' or jsonb_typeof(p_data->'approve') is distinct from 'boolean' then raise exception 'Pending request and boolean approve required' using errcode='22023'; end if;
   select * into s from public.hr_shifts where id=q.shift_id for update;
   v_end:=q.requested_end;
  end if;
  if v_end is null or not isfinite(v_end) or v_end<=s.start_at or v_end>v_now or coalesce(btrim(p_data->>'reason'),'')='' then
   raise exception 'Valid end time and reason required' using errcode='22023'; end if;
  if exists(select 1 from public.hr_payrolls h where h.employee_id=e and h.status='approved'
   and tstzrange(s.start_at,greatest(coalesce(s.end_at,'infinity'),v_end),'[)') && tstzrange(h.period_start::timestamp at time zone 'Africa/Cairo',(h.period_end+1)::timestamp at time zone 'Africa/Cairo','[)')) then
   raise exception 'Correction affects approved payroll' using errcode='22023'; end if;
  if p_action='correct' then
   insert into public.hr_requests(employee_id,shift_id,requested_end,reason) values(e,s.id,v_end,btrim(p_data->>'reason')) returning to_jsonb(hr_requests) into result;
  else
   if (p_data->>'approve')::boolean then
    if exists(select 1 from public.hr_shifts b where b.employee_id=e and b.id<>s.id and tstzrange(b.start_at,b.end_at,'[)') && tstzrange(s.start_at,v_end,'[)')) then
     raise exception 'Correction conflicts with another shift' using errcode='22023'; end if;
    -- A corrected checkout clips personal pauses too. Entirely later pauses
    -- are removed; audit triggers retain every original row before clipping.
    delete from public.hr_breaks where shift_id=s.id and start_at>=v_end;
    update public.hr_breaks set end_at=v_end where shift_id=s.id and (end_at is null or end_at>v_end);
    update public.hr_shifts set end_at=v_end where id=s.id;
   end if;
   update public.hr_requests set status=case when (p_data->>'approve')::boolean then 'approved' else 'rejected' end,review_note=btrim(p_data->>'reason') where id=q.id returning to_jsonb(hr_requests) into result;
  end if;
 elsif p_action='set_rate' then
  v_date:=(p_data->>'effective_on')::date; amount:=(p_data->>'hourly_rate')::numeric;
  if v_date is null or not isfinite(v_date) or jsonb_typeof(p_data->'hourly_rate') is distinct from 'number' or amount<0 or amount>='Infinity'::numeric then raise exception 'Invalid rate' using errcode='22023'; end if;
  select min(effective_on) into next_date from public.hr_rates where employee_id=e and effective_on>v_date;
  if exists(select 1 from public.hr_payrolls where employee_id=e and status='approved' and daterange(period_start,period_end,'[]') && daterange(v_date,next_date,'[)')) then
   raise exception 'Rate affects approved payroll' using errcode='22023'; end if;
  insert into public.hr_rates(employee_id,effective_on,hourly_rate) values(e,v_date,amount)
   on conflict(employee_id,effective_on) do update set hourly_rate=excluded.hourly_rate returning to_jsonb(hr_rates) into result;
 elsif p_action='set_settings' then
  if jsonb_typeof(p_data->'reminder_hours') is distinct from 'number' then raise exception 'Numeric reminder hours required' using errcode='22023'; end if;
  update public.hr_settings set reminder_hours=(p_data->>'reminder_hours')::numeric returning to_jsonb(hr_settings)-'singleton' into result;
 elsif p_action='convert_staff' then
  select to_jsonb(x) into original from public.profiles x where id=e for update;
  if original->>'role'<>'cashier' or exists(select 1 from public.hr_shifts where employee_id=e and end_at is null) then
   raise exception 'Only cashier without an open shift can convert' using errcode='22023'; end if;
  update public.profiles set role='staff',shop_id=null where id=e returning to_jsonb(profiles) into result;
  insert into public.hr_audit(actor_id,request_id,entity,row_id,before_data,after_data) values(u,p_request_id,'profiles',e::text,original,result);
 elsif p_action='create_payroll' then
  calc:=private.hr_calculate(e,(p_data->>'period_start')::date,(p_data->>'period_end')::date,coalesce(p_data->'adjustments','[]'));
  insert into public.hr_payrolls(employee_id,period_start,period_end,work_minutes,gross,adjustments,net,snapshot)
   values(e,(p_data->>'period_start')::date,(p_data->>'period_end')::date,(calc->>'work_minutes')::numeric,(calc->>'gross')::numeric,calc->'adjustments',(calc->>'net')::numeric,calc)
   returning to_jsonb(hr_payrolls) into result;
 elsif p_action in ('approve_payroll','record_payment') then
  select * into p from public.hr_payrolls where id=(p_data->>'payroll_id')::uuid for update;
  if p_action='approve_payroll' then
   if p.status<>'draft' then raise exception 'Payroll is not a draft' using errcode='22023'; end if;
   if p.period_end>=(v_now at time zone 'Africa/Cairo')::date then
    raise exception 'Wait until all payroll range days have ended in Cairo before approval' using errcode='22023'; end if;
   if exists(select 1 from public.hr_payrolls h where h.employee_id=e and h.status='approved' and daterange(h.period_start,h.period_end,'[]') && daterange(p.period_start,p.period_end,'[]')) then
    raise exception 'Approved payroll periods overlap' using errcode='22023'; end if;
   calc:=private.hr_calculate(e,p.period_start,p.period_end,p.adjustments);
   if (calc->>'missing_rates')::boolean or (calc->>'open_shifts')::boolean or (calc->>'pending_corrections')::boolean then
    raise exception 'Payroll has open shifts, missing rates or pending corrections' using errcode='22023'; end if;
   update public.hr_payrolls set status='approved',work_minutes=(calc->>'work_minutes')::numeric,gross=(calc->>'gross')::numeric,net=(calc->>'net')::numeric,snapshot=calc,approved_at=v_now
    where id=p.id returning to_jsonb(hr_payrolls) into result;
  else
   amount:=(p_data->>'amount')::numeric; v_date:=(p_data->>'paid_on')::date;
   if p.status<>'approved' or jsonb_typeof(p_data->'amount') is distinct from 'number' or amount<=0 or amount>='Infinity'::numeric or amount<>round(amount,2)
    or v_date is null or not isfinite(v_date) or v_date>(v_now at time zone 'Africa/Cairo')::date then raise exception 'Approved payroll, positive currency amount and valid payment date required' using errcode='22023'; end if;
   if amount+coalesce((select sum(x.amount) from public.hr_payments x where x.payroll_id=p.id),0)>p.net then raise exception 'Payment exceeds net pay' using errcode='22023'; end if;
   insert into public.hr_payments(payroll_id,amount,paid_on,note) values(p.id,amount,v_date,coalesce(p_data->>'note','')) returning to_jsonb(hr_payments) into result;
  end if;
 end if;
 insert into public.hr_commands values(u,p_request_id,p_action,p_data,result);
 perform set_config('hr.request_id','',true);
 return result;
end $$;

-- Shared secret stays private. Support the existing singleton push_secret or
-- key/value settings representation without touching either secrets or PINs.
create function private.hr_push_alert() returns trigger language plpgsql security definer set search_path='' as $$
declare secret text;
begin
 select coalesce(j->>'push_secret',case when coalesce(j->>'key',j->>'name')='push_secret' then j->>'value' end)
 into secret from (select to_jsonb(s) j from private.settings s) x
 where j ? 'push_secret' or coalesce(j->>'key',j->>'name')='push_secret' limit 1;
 if coalesce(secret,'')='' then raise warning 'HR push skipped: private.settings push_secret missing'; return new; end if;
 perform net.http_post(url:='https://srpgxvdbpkinrvklwywx.supabase.co/functions/v1/push-hr',
  headers:=jsonb_build_object('Content-Type','application/json','x-push-secret',secret),body:=jsonb_build_object('id',new.id));
 return new;
end $$;
create trigger hr_alerts_push after insert on public.hr_alerts for each row execute function private.hr_push_alert();
create function public.hr_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare s record; n integer:=0; alert_id uuid;
begin
 -- ACL is the authority, rather than spoofable JWT/GUC claims. Only the DB
 -- owner and service_role receive EXECUTE; no employee can call this job.
 for s in select h.*,p.name from public.hr_shifts h join public.profiles p on p.id=h.employee_id
  cross join public.hr_settings cfg where p.active and h.end_at is null
  and h.start_at<clock_timestamp()-make_interval(secs=>(cfg.reminder_hours*3600)::double precision)
 loop
  insert into public.hr_alerts(employee_id,shift_id,text) values(s.employee_id,s.id,s.name||': الوردية ما زالت مفتوحة، راجع موعد الانصراف')
   on conflict(shift_id) do nothing returning id into alert_id;
  if found then
   insert into public.notes(text,kind) values(s.name||': الوردية ما زالت مفتوحة (تذكير الحضور)','attendance');
   n:=n+1;
  end if;
 end loop;
 return n;
end $$;
-- Service Edge Function can look up an alert by id (it has BYPASSRLS).
grant select on public.hr_alerts to service_role;
revoke all on function public.hr_reminders() from public,anon,authenticated;
grant execute on function public.hr_reminders() to service_role,postgres;
revoke all on function private.hr_audit_row(),private.hr_append_only(),private.hr_calculate(uuid,date,date,jsonb),private.hr_push_alert() from public,anon,authenticated;
revoke all on function public.hr_active(),public.hr_visible(uuid),public.hr_snapshot(),public.hr_command(text,jsonb,uuid) from public,anon;
grant execute on function public.hr_active(),public.hr_visible(uuid),public.hr_snapshot(),public.hr_command(text,jsonb,uuid) to authenticated;
do $$ declare t text; begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['settings','rates','shifts','breaks','requests','payrolls','payments','alerts'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='hr_'||t) then
    execute format('alter publication supabase_realtime add table public.hr_%I',t);
   end if;
  end loop;
 end if;
end $$;
do $$ begin
 begin
  create extension if not exists pg_cron with schema pg_catalog;
 exception when feature_not_supported or undefined_file or insufficient_privilege or object_not_in_prerequisite_state then
  raise notice 'pg_cron unavailable; enable Cron and schedule public.hr_reminders() every five minutes';
 end;
 if exists(select 1 from pg_extension where extname='pg_cron') then
  if not exists(select 1 from cron.job where jobname='hr-attendance-reminders') then
   perform cron.schedule('hr-attendance-reminders','*/5 * * * *','select public.hr_reminders()');
  end if;
 end if;
end $$;
commit;
