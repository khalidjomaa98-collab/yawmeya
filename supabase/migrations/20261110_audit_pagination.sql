create index hr_audit_created_page on public.hr_audit(created_at desc,id desc);
create function public.hcash_audit_page(p_before timestamptz default null,p_id uuid default null,p_limit integer default 100) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;cursor_row public.hr_audit; more boolean;
begin
 if not public.hr_active() or not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 if p_limit<1 or p_limit>100 or (p_before is null)<>(p_id is null) then raise exception 'Invalid page' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id desc),'[]') into rows from (select * from public.hr_audit where p_before is null or (created_at,id)<(p_before,p_id) order by created_at desc,id desc limit p_limit) a;
 if jsonb_array_length(rows)=p_limit then
  select * into cursor_row from jsonb_populate_record(null::public.hr_audit,rows->(jsonb_array_length(rows)-1));
  select exists(select 1 from public.hr_audit where (created_at,id)<(cursor_row.created_at,cursor_row.id)) into more;
 end if;
 return jsonb_build_object('rows',rows,'next',case when more then jsonb_build_object('time',cursor_row.created_at,'id',cursor_row.id) else null end);
end $$;
revoke all on function public.hcash_audit_page(timestamptz,uuid,integer) from public,anon;
grant execute on function public.hcash_audit_page(timestamptz,uuid,integer) to authenticated;
do $patch$ declare definition text;needle text;begin
 select pg_get_functiondef('public.hr_snapshot()'::regprocedure) into definition;
 needle:='''audit'',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),''[]'') from public.hr_audit a where public.is_admin())';
 if position(needle in definition)=0 then raise exception 'Audit aggregate not found';end if;
 execute replace(definition,needle,'''audit'',''[]''::jsonb');
end $patch$;
