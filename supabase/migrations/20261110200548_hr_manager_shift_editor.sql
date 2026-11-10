-- Manager-only historical entry and correction. All writes use hr_command's
-- employee lock, retry identity and audit triggers; approved payroll stays frozen.
alter table public.hr_shifts add column change_reason text;
alter table public.hr_shifts add column recorded_by uuid references public.profiles(id);

create function private.hr_admin_save_shift(p_action text,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 u uuid:=auth.uid(); target uuid; s public.hr_shifts; v_id uuid;
 v_start timestamptz; v_end timestamptz; v_now timestamptz:=clock_timestamp();
 reason text:=btrim(p_data->>'reason'); item jsonb; all_breaks jsonb:=p_data->'breaks';
 original_breaks jsonb; actual jsonb; a timestamptz; b timestamptz; last_end timestamptz;
 bid uuid; used_ids uuid[]:='{}'; first_pause boolean:=true;
begin
 if not public.hr_active() or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 if p_action not in ('admin_add_shift','admin_update_shift') then raise exception 'Unknown manual action' using errcode='22023';end if;
 if reason is null or length(reason)=0 or length(reason)>500 then raise exception 'Reason required (max 500)' using errcode='22023';end if;
 if p_action='admin_update_shift' then
  select * into s from public.hr_shifts where id=(p_data->>'shift_id')::uuid for update;
  if not found then raise exception 'Shift not found' using errcode='22023';end if;
  target:=s.employee_id;v_id:=s.id;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) into original_breaks from public.hr_breaks x where x.shift_id=s.id;
  actual:=jsonb_build_object('shift',to_jsonb(s),'breaks',original_breaks);
  if p_data->'expected_snapshot' is distinct from actual then raise exception 'Shift changed; refresh before editing' using errcode='22023';end if;
  if exists(select 1 from public.hr_requests where shift_id=s.id and status='pending') then raise exception 'Review pending correction first' using errcode='22023';end if;
 else
  target:=(p_data->>'employee_id')::uuid;v_id:=gen_random_uuid();
 end if;
 if not exists(select 1 from public.profiles where id=target and role in ('cashier','staff')) then raise exception 'Employee required' using errcode='22023';end if;
 -- This lock is also held by the caller, and protects this helper if reused.
 perform pg_advisory_xact_lock(hashtextextended('hr:employee:'||target::text,0));
 v_start:=(p_data->>'start_at')::timestamptz;v_end:=(p_data->>'end_at')::timestamptz;
 if v_start is null or not isfinite(v_start) or v_start>v_now or
  (v_end is not null and (not isfinite(v_end) or v_end<=v_start or v_end>v_now)) then
  raise exception 'Invalid manual shift time' using errcode='22023';end if;
 if exists(select 1 from public.hr_payrolls h where h.employee_id=target and h.status='approved' and
  (tstzrange(v_start,v_end,'[)') && tstzrange(h.period_start::timestamp at time zone 'Africa/Cairo',(h.period_end+1)::timestamp at time zone 'Africa/Cairo','[)') or
   (s.id is not null and tstzrange(s.start_at,s.end_at,'[)') && tstzrange(h.period_start::timestamp at time zone 'Africa/Cairo',(h.period_end+1)::timestamp at time zone 'Africa/Cairo','[)')))) then
  raise exception 'Manual shift affects approved payroll' using errcode='22023';end if;
 if exists(select 1 from public.hr_shifts x where x.employee_id=target and x.id<>v_id and tstzrange(x.start_at,x.end_at,'[)') && tstzrange(v_start,v_end,'[)')) then
  raise exception 'Shift overlap' using errcode='22023';end if;
 if jsonb_typeof(all_breaks) is distinct from 'array' then raise exception 'Personal pause array required' using errcode='22023';end if;
 if jsonb_array_length(all_breaks)>100 then raise exception 'Too many personal pauses' using errcode='22023';end if;
 -- Validate everything before writing, including break IDs from other shifts.
 for item in select value from jsonb_array_elements(all_breaks) order by (value->>'start_at')::timestamptz loop
  a:=(item->>'start_at')::timestamptz;b:=(item->>'end_at')::timestamptz;bid:=nullif(item->>'id','')::uuid;
  if jsonb_typeof(item) is distinct from 'object' or a is null or not isfinite(a) or a<v_start or a>coalesce(v_end,v_now) or
   (b is null and v_end is not null) or (b is not null and (not isfinite(b) or b<=a or b>coalesce(v_end,v_now))) or
   (not first_pause and (last_end is null or a<last_end)) then raise exception 'Personal pause invalid or overlap' using errcode='22023';end if;
  if bid is not null and (bid=any(used_ids) or not exists(select 1 from public.hr_breaks where id=bid and shift_id=v_id)) then raise exception 'Personal pause ID invalid' using errcode='22023';end if;
  if bid is not null then used_ids:=array_append(used_ids,bid);end if;
  first_pause:=false;last_end:=b;
 end loop;
 if p_action='admin_add_shift' then
  insert into public.hr_shifts(id,employee_id,start_at,end_at,change_reason,recorded_by) values(v_id,target,v_start,v_end,reason,u);
 else
  update public.hr_shifts set start_at=v_start,end_at=v_end,change_reason=reason,recorded_by=u where id=v_id;
 end if;
 delete from public.hr_breaks where shift_id=v_id and not (id=any(used_ids));
 for item in select value from jsonb_array_elements(all_breaks) loop
  bid:=nullif(item->>'id','')::uuid;
  if bid is null then
   insert into public.hr_breaks(shift_id,start_at,end_at) values(v_id,(item->>'start_at')::timestamptz,(item->>'end_at')::timestamptz);
  else
   update public.hr_breaks set start_at=(item->>'start_at')::timestamptz,end_at=(item->>'end_at')::timestamptz where id=bid and shift_id=v_id;
  end if;
 end loop;
 return (select to_jsonb(x) from public.hr_shifts x where id=v_id);
end $$;
revoke all on function private.hr_admin_save_shift(text,jsonb) from public,anon,authenticated;

do $patch$
declare definition text; needle text;
begin
 select pg_get_functiondef('public.hr_command(text,jsonb,uuid)'::regprocedure) into definition;
 needle:='if p_action not in (''clock_in'',''clock_out'',''pause'',''resume'',''correct'',''approve_correction'',''set_rate'',''set_settings'',''convert_staff'',''create_payroll'',''approve_payroll'',''record_payment'') then';
 if position(needle in definition)=0 then raise exception 'HR action guard not found';end if;
 definition:=replace(definition,needle,'if p_action not in (''clock_in'',''clock_out'',''pause'',''resume'',''correct'',''approve_correction'',''set_rate'',''set_settings'',''convert_staff'',''create_payroll'',''approve_payroll'',''record_payment'',''admin_add_shift'',''admin_update_shift'') then');
 definition:=replace(definition,'if p_action in (''set_rate'',''convert_staff'',''create_payroll'') then','if p_action in (''set_rate'',''convert_staff'',''create_payroll'',''admin_add_shift'') then');
 definition:=replace(definition,'elsif p_action=''correct'' then select employee_id into e','elsif p_action=''admin_update_shift'' then select employee_id into e from public.hr_shifts where id=(p_data->>''shift_id'')::uuid;'||E'\n elsif p_action=''correct'' then select employee_id into e');
 needle:='if p_action in (''clock_in'',''clock_out'',''pause'',''resume'') then';
 if position(needle in definition)=0 then raise exception 'HR clock branch not found';end if;
 definition:=replace(definition,needle,'if p_action in (''admin_add_shift'',''admin_update_shift'') then result:=private.hr_admin_save_shift(p_action,p_data);'||E'\n elsif p_action in (''clock_in'',''clock_out'',''pause'',''resume'') then');
 execute definition;
end $patch$;
