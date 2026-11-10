create function public.hr_preview_payroll(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.hr_payrolls; calc jsonb;
begin
 if not public.hr_active() or not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 select * into p from public.hr_payrolls where id=p_id;
 if not found then raise exception 'Payroll not found' using errcode='22023';end if;
 if p.status='approved' then return to_jsonb(p);end if;
 calc:=private.hr_calculate(p.employee_id,p.period_start,p.period_end,p.adjustments);
 return to_jsonb(p)||jsonb_build_object('work_minutes',calc->'work_minutes','gross',calc->'gross','net',calc->'net','snapshot',calc);
end $$;
revoke all on function public.hr_preview_payroll(uuid) from public,anon;
grant execute on function public.hr_preview_payroll(uuid) to authenticated;
do $patch$ declare definition text; needle text; replacement text;begin
 select pg_get_functiondef('public.hr_command(text,jsonb,uuid)'::regprocedure) into definition;
 needle:='calc:=private.hr_calculate(e,p.period_start,p.period_end,p.adjustments);';
 replacement:=needle||E'\n   if p_data ? ''expected_snapshot'' and p_data->''expected_snapshot'' is distinct from calc then raise exception ''Payroll changed; review again'' using errcode=''22023''; end if;';
 if position(needle in definition)=0 then raise exception 'Approval calculation not found';end if;
 execute replace(definition,needle,replacement);
end $patch$;
