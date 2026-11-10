create function public.hcash_owner_wipe(p_owner uuid,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare nt integer;ns integer;nn integer;
begin
 if not exists(select 1 from public.profiles where id=p_owner and active and role='admin') then raise exception 'Admin required' using errcode='42501';end if;
 if jsonb_typeof(p_snapshot->'tables'->'txs') is distinct from 'array' or jsonb_typeof(p_snapshot->'tables'->'device_sales') is distinct from 'array' or jsonb_typeof(p_snapshot->'tables'->'notes') is distinct from 'array' then raise exception 'Verified snapshot required' using errcode='22023';end if;
 perform set_config('request.jwt.claim.sub',p_owner::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_owner,'role','service_role')::text,true);
 -- Delete only records that are actually in the verified backup AND unchanged.
 -- Cashier activity arriving while the backup is made must survive the wipe.
 delete from public.txs live using jsonb_populate_recordset(null::public.txs,p_snapshot->'tables'->'txs') saved where live.id=saved.id and to_jsonb(live)=to_jsonb(saved);get diagnostics nt=row_count;
 delete from public.device_sales live using jsonb_populate_recordset(null::public.device_sales,p_snapshot->'tables'->'device_sales') saved where live.id=saved.id and to_jsonb(live)=to_jsonb(saved);get diagnostics ns=row_count;
 delete from public.notes live using jsonb_populate_recordset(null::public.notes,p_snapshot->'tables'->'notes') saved where live.id=saved.id and to_jsonb(live)=to_jsonb(saved);get diagnostics nn=row_count;
 return jsonb_build_object('transactions_deleted',nt,'sales_deleted',ns,'notes_deleted',nn,'remaining',(select count(*) from public.txs)+(select count(*) from public.device_sales)+(select count(*) from public.notes));
end $$;
revoke all on function public.hcash_owner_wipe(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.hcash_owner_wipe(uuid,jsonb) to service_role;
revoke all on function public.hcash_owner_wipe(uuid) from service_role;

