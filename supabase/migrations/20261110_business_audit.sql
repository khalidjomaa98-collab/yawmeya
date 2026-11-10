create function private.business_audit_row() returns trigger language plpgsql security definer set search_path='' as $$
declare before_row jsonb; after_row jsonb; identity_key text;
begin
 if tg_op<>'INSERT' then before_row:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then after_row:=to_jsonb(new); end if;
 if before_row is not distinct from after_row then return null; end if;
 -- convert_staff already appends its own profile audit.
 if tg_table_name='profiles' and tg_op='UPDATE' and after_row->>'role'='staff' and before_row->>'role'='cashier' then return null; end if;
 identity_key:=coalesce(after_row->>'id',before_row->>'id',coalesce(after_row->>'shop_id',before_row->>'shop_id')||':'||coalesce(after_row->>'key',before_row->>'key'),'record');
 insert into public.hr_audit(actor_id,entity,row_id,before_data,after_data) values(auth.uid(),tg_table_name,identity_key,before_row,after_row);
 return null;
end $$;
revoke all on function private.business_audit_row() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['txs','devices','device_sales','shop_days','shops','shop_drawers','parties','profiles'] loop
  execute format('create trigger business_audit after insert or update or delete on public.%I for each row execute function private.business_audit_row()',t);
 end loop;
end $$;
