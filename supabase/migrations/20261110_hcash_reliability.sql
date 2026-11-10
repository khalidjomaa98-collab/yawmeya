-- H-Cash: atomic, replayable financial writes and owner-only backup infrastructure.
create function public.hcash_post_tx(p_id uuid,p_shop uuid,p_party uuid,p_name text,p_type text,p_amount numeric,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare x public.txs; s uuid;
begin
 if not public.is_active_user() then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 if p_id is null or p_party is null or p_type not in ('took','gave') or p_amount is null or p_amount<=0 or p_amount>='Infinity'::numeric then raise exception 'Invalid transaction' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('hcash:tx:'||p_id::text,0));
 select * into x from public.txs where id=p_id;
 if found then
  if x.user_id<>auth.uid() or x.shop_id is distinct from p_shop or x.party_id is distinct from p_party or x.type<>p_type or x.amount<>p_amount or coalesce(x.note,'')<>coalesce(p_note,'') then raise exception 'Request conflict' using errcode='22023';end if;
  return to_jsonb(x);
 end if;
 s:=case when public.is_admin() then p_shop else public.my_shop() end;
 if s is null or s is distinct from p_shop then raise exception 'NO_SHOP' using errcode='42501';end if;
 if not exists(select 1 from public.parties where id=p_party) then
  if coalesce(btrim(p_name),'')='' then raise exception 'PARTY_REQUIRED' using errcode='22023';end if;
  insert into public.parties(id,kind,name) values(p_party,'customer',btrim(p_name));
 end if;
 insert into public.txs(id,shop_id,type,party_id,amount,note) values(p_id,s,p_type,p_party,p_amount,coalesce(p_note,'')) returning * into x;
 return to_jsonb(x);
end $$;
create function public.hcash_post_sale(p_id uuid,p_device uuid,p_qty integer,p_price numeric,p_pay text,p_voucher text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare x public.device_sales;
begin
 if not public.is_active_user() then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 if p_id is null or p_price is null or p_price<0 or p_price>='Infinity'::numeric then raise exception 'Invalid sale' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('hcash:sale:'||p_id::text,0));
 select * into x from public.device_sales where id=p_id;
 if found then
  if x.user_id<>auth.uid() or x.device_id is distinct from p_device or x.qty is distinct from p_qty or x.sell_price<>p_price or x.pay is distinct from p_pay or coalesce(x.voucher,'')<>coalesce(nullif(btrim(p_voucher),''),'') then raise exception 'Request conflict' using errcode='22023';end if;
  return to_jsonb(x);
 end if;
 perform public.sell_device(p_id,p_device,p_qty,p_price,p_pay,p_voucher);
 select * into x from public.device_sales where id=p_id;
 return to_jsonb(x);
end $$;
revoke all on function public.hcash_post_tx(uuid,uuid,uuid,text,text,numeric,text),public.hcash_post_sale(uuid,uuid,integer,numeric,text,text) from public,anon;
grant execute on function public.hcash_post_tx(uuid,uuid,uuid,text,text,numeric,text),public.hcash_post_sale(uuid,uuid,integer,numeric,text,text) to authenticated;

create function public.hcash_owner_wipe(p_owner uuid) returns integer language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=p_owner and active and role='admin') then raise exception 'Admin required' using errcode='42501';end if;
 perform set_config('request.jwt.claim.sub',p_owner::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_owner,'role','service_role')::text,true);
 return public.wipe_all();
end $$;
revoke all on function public.wipe_all() from public,anon,authenticated;
revoke all on function public.hcash_owner_wipe(uuid) from public,anon,authenticated;
grant execute on function public.hcash_owner_wipe(uuid) to service_role;

create table public.hcash_backups (
 id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now(),status text not null default 'working' check(status in ('working','ready','failed')),
 path text,sha256 text,row_counts jsonb not null default '{}',bytes bigint,checked_at timestamptz,error text
);
alter table public.hcash_backups enable row level security;
revoke all on public.hcash_backups from public,anon,authenticated;
grant select on public.hcash_backups to authenticated;
grant all on public.hcash_backups to service_role;
create policy hcash_backups_owner on public.hcash_backups for select to authenticated using(public.is_admin());
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('hcash-backups','hcash-backups',false,52428800,array['application/json']) on conflict(id) do update set public=false;

create function public.hcash_backup_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t text; result jsonb:='{}'; rows jsonb;
begin
 foreach t in array array['shops','shop_drawers','profiles','parties','shop_days','txs','devices','device_sales','notes','hr_settings','hr_rates','hr_shifts','hr_breaks','hr_requests','hr_payrolls','hr_payments','hr_alerts','hr_commands','hr_audit'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]'') from public.%I x',t) into rows;result:=result||jsonb_build_object(t,rows);
 end loop;
 return jsonb_build_object('schema_version',1,'created_at',statement_timestamp(),'app','H-Cash','tables',result,'scope','Business records and account metadata; authentication credentials and push tokens excluded');
end $$;
revoke all on function public.hcash_backup_snapshot() from public,anon,authenticated;
grant execute on function public.hcash_backup_snapshot() to service_role;

create function public.hcash_check_backup(p_doc jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t text; counts jsonb:='{}'; n bigint; fk record; source_cols text; joins text; target_table text; tables text[]:=array['shops','shop_drawers','profiles','parties','shop_days','txs','devices','device_sales','notes','hr_settings','hr_rates','hr_shifts','hr_breaks','hr_requests','hr_payrolls','hr_payments','hr_alerts','hr_commands','hr_audit'];
begin
 if p_doc->>'schema_version'<>'1' or jsonb_typeof(p_doc->'tables') is distinct from 'object' then raise exception 'Unsupported backup format' using errcode='22023';end if;
 foreach t in array tables loop
  if jsonb_typeof(p_doc->'tables'->t) is distinct from 'array' then raise exception 'Missing backup table: %',t using errcode='22023';end if;
  execute format('drop table if exists pg_temp.%I','hcash_restore_'||t);
  execute format('create temporary table %I (like public.%I including all) on commit drop','hcash_restore_'||t,t);
  execute format('insert into pg_temp.%I select * from jsonb_populate_recordset(null::public.%I,$1)','hcash_restore_'||t,t) using p_doc->'tables'->t;
  execute format('select count(*) from pg_temp.%I','hcash_restore_'||t) into n;counts:=counts||jsonb_build_object(t,n);
 end loop;
 -- Reconstruct every row with original types/checks/unique keys, then verify FKs.
 for fk in select c.*,s.relname src,r.relname dst,rn.nspname dst_schema from pg_constraint c join pg_class s on s.oid=c.conrelid join pg_namespace sn on sn.oid=s.relnamespace join pg_class r on r.oid=c.confrelid join pg_namespace rn on rn.oid=r.relnamespace where c.contype='f' and sn.nspname='public' and s.relname=any(tables) loop
  select string_agg(format('s.%I is not null',a.attname),' and '),string_agg(format('s.%I = r.%I',a.attname,b.attname),' and ') into source_cols,joins from unnest(fk.conkey,fk.confkey) as k(aid,bid) join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k.aid join pg_attribute b on b.attrelid=fk.confrelid and b.attnum=k.bid;
  target_table:=case when fk.dst_schema='public' and fk.dst=any(tables) then format('pg_temp.%I','hcash_restore_'||fk.dst) else format('%I.%I',fk.dst_schema,fk.dst) end;
  execute format('select count(*) from pg_temp.%I s where %s and not exists(select 1 from %s r where %s)','hcash_restore_'||fk.src,source_cols,target_table,joins) into n;
  if n>0 then raise exception 'Backup relation missing: %',fk.conname using errcode='22023';end if;
 end loop;
 return jsonb_build_object('valid',true,'reconstructed_rows',counts,'method','Isolated temporary reconstruction with types, checks, uniqueness and foreign-key validation; no live rows changed');
end $$;
revoke all on function public.hcash_check_backup(jsonb) from public,anon,authenticated;
grant execute on function public.hcash_check_backup(jsonb) to service_role;

create function private.hcash_scheduled_backup() returns void language plpgsql security definer set search_path='' as $$
declare secret text;
begin
 select coalesce(j->>'push_secret',case when coalesce(j->>'key',j->>'name')='push_secret' then j->>'value' end) into secret from (select to_jsonb(s) j from private.settings s)x where j?'push_secret' or coalesce(j->>'key',j->>'name')='push_secret' limit 1;
 if coalesce(secret,'')='' then raise exception 'Backup scheduler secret missing';end if;
 perform net.http_post(url:='https://srpgxvdbpkinrvklwywx.supabase.co/functions/v1/hcash-backup',headers:=jsonb_build_object('Content-Type','application/json','x-push-secret',secret),body:='{"action":"scheduled"}'::jsonb,timeout_milliseconds:=10000);
end $$;
revoke all on function private.hcash_scheduled_backup() from public,anon,authenticated;
select cron.schedule('hcash-daily-backup','0 1 * * *','select private.hcash_scheduled_backup()');

