-- Cancellation retains the original row. Legacy delete_tx calls share the same
-- reason requirement, row lock, audit trail and existing cashier scope.
create or replace function public.delete_tx(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare t public.txs; adm boolean:=public.is_admin(); reason text:=btrim(p_reason);
begin
 if not public.is_active_user() then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 if reason is null or length(reason)<3 or length(reason)>500 then raise exception 'CANCEL_REASON_REQUIRED' using errcode='22023';end if;
 select * into t from public.txs where id=p_id for update;
 if not found then raise exception 'NOT_FOUND' using errcode='22023';end if;
 if not adm and (t.user_id<>auth.uid() or t.day_id is distinct from public.my_open_day()) then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 if t.deleted_at is not null then return;end if;
 update public.txs set deleted_at=clock_timestamp(),deleted_by=auth.uid(),delete_reason=reason,delete_ack=false where id=p_id;
 if not adm then
  insert into public.notes(text,kind)
  select format('%s ألغى حركة: %s %s · %s (%s). السبب: %s',p.name,private.type_label(t.type),pa.name,private.fmt(t.amount),s.name,reason),'del'
  from public.profiles p,public.parties pa,public.shops s where p.id=auth.uid() and pa.id=t.party_id and s.id=t.shop_id;
 end if;
end $$;
revoke all on function public.delete_tx(uuid,text) from public,anon;
grant execute on function public.delete_tx(uuid,text) to authenticated;

-- Defense against bypassing the RPC via an owner's direct table UPDATE.
create function private.hcash_tx_cancel_reason() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.deleted_at is null and new.deleted_at is not null and
  (new.deleted_by is null or coalesce(length(btrim(new.delete_reason)),0)<3 or length(new.delete_reason)>500) then
  raise exception 'CANCEL_REASON_REQUIRED' using errcode='22023';end if;
 return new;
end $$;
revoke all on function private.hcash_tx_cancel_reason() from public,anon,authenticated;
create trigger hcash_cancel_reason before update on public.txs for each row execute function private.hcash_tx_cancel_reason();

create function public.hcash_restore_tx(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare t public.txs; reason text:=btrim(p_reason);
begin
 if not public.is_active_user() or not public.is_admin() then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 if coalesce(length(reason),0)<3 or length(reason)>500 then raise exception 'CANCEL_REASON_REQUIRED' using errcode='22023';end if;
 select * into t from public.txs where id=p_id for update;
 if not found then raise exception 'NOT_FOUND' using errcode='22023';end if;
 if t.deleted_at is null then return;end if;
 update public.txs set deleted_at=null,deleted_by=null,delete_reason='إعادة تفعيل: '||reason,
  transferred_at=case when t.delete_ack then null else t.transferred_at end,delete_ack=false where id=p_id;
end $$;
revoke all on function public.hcash_restore_tx(uuid,text) from public,anon;
grant execute on function public.hcash_restore_tx(uuid,text) to authenticated;

-- Cashiers retain their own cancelled rows only within the currently open day.
alter policy txs_read on public.txs using ((select public.is_admin()) or
 ((select public.is_active_user()) and day_id=(select public.my_open_day()) and (deleted_at is null or user_id=(select auth.uid()))));
do $snapshot$ declare definition text; needle text;begin
 select pg_get_functiondef('public.hcash_ledger_snapshot()'::regprocedure) into definition;
 needle:='t.shop_id=own and t.day_id=open_day and t.deleted_at is null';
 if position(needle in definition)=0 then raise exception 'Cashier snapshot guard missing';end if;
 execute replace(definition,needle,'t.shop_id=own and t.day_id=open_day and (t.deleted_at is null or t.user_id=auth.uid())');
end $snapshot$;

create function private.hcash_search_text(value text) returns text language sql immutable strict set search_path='' as $$
 select regexp_replace(translate(lower(replace(value,'ـ','')),'أإآةى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','اااهي01234567890123456789'),'[ً-ٟ]','','g');
$$;
revoke all on function private.hcash_search_text(text) from public,anon,authenticated;

create function public.hcash_search(p_query text,p_kind text default 'all',p_offset integer default 0,p_scope text default null,p_entity uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare adm boolean;own uuid;open_id uuid;q text:=private.hcash_search_text(btrim(p_query));result jsonb;page_size integer:=15;
begin
 if not public.is_active_user() then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 adm:=public.is_admin();own:=public.my_shop();open_id:=public.my_open_day();
 if q is null or length(q)<2 or length(q)>80 or p_kind is null or p_kind not in ('all','party','device','employee','tx','sale','return') or
  p_offset is null or p_offset<0 or p_offset>10000 or (p_scope is not null and (p_scope not in ('party','device','employee') or p_entity is null)) then
  raise exception 'INVALID_SEARCH' using errcode='22023';end if;
 with candidates as (
  select 'party'::text kind,p.id,p.name title,p.phone subtitle,null::timestamptz at,
   jsonb_build_object('id',p.id,'name',p.name,'phone',p.phone) record
  from public.parties p where p_scope is null and strpos(private.hcash_search_text(p.name||' '||coalesce(p.phone,'')),q)>0 and p_kind in ('all','party')
  union all
  select 'device',d.id,d.name,s.name,null::timestamptz,
   jsonb_build_object('id',d.id,'name',d.name,'shop_id',d.shop_id,'sell_price',d.sell_price,'qty',d.qty,'archived',d.archived)
  from public.devices d join public.shops s on s.id=d.shop_id where p_scope is null and (adm or (d.shop_id=own and not d.archived))
   and strpos(private.hcash_search_text(d.name||' '||s.name),q)>0 and p_kind in ('all','device')
  union all
  select 'employee',p.id,p.name,case p.role when 'cashier' then 'كاشير' else 'موظف' end,null::timestamptz,
   jsonb_build_object('id',p.id,'name',p.name,'role',p.role,'active',p.active)
  from public.profiles p where adm and p.role in ('cashier','staff') and p_scope is null and strpos(private.hcash_search_text(p.name),q)>0 and p_kind in ('all','employee')
  union all
  select 'tx',t.id,p.name,s.name,t.ts,to_jsonb(t)
  from public.txs t join public.parties p on p.id=t.party_id join public.shops s on s.id=t.shop_id join public.profiles u on u.id=t.user_id
  where (adm or (t.shop_id=own and t.day_id=open_id and (t.deleted_at is null or t.user_id=auth.uid()))) and p_kind in ('all','tx') and
   ((p_scope='party' and t.party_id=p_entity) or (p_scope='employee' and t.user_id=p_entity) or (p_scope is null and strpos(private.hcash_search_text(p.name||' '||coalesce(t.note,'')||' '||t.amount::text||' '||u.name||' '||s.name||' '||coalesce(t.delete_reason,'')),q)>0))
  union all
  select 'sale',v.id,v.device_name,s.name,v.ts,case when public.hcash_can_cost() then to_jsonb(v) else to_jsonb(v)-'buy_price' end
  from public.device_sales v join public.shops s on s.id=v.shop_id join public.profiles u on u.id=v.user_id
  where (adm or (v.shop_id=own and v.day_id=open_id)) and p_kind in ('all','sale') and
   ((p_scope='device' and v.device_id=p_entity) or (p_scope='employee' and v.user_id=p_entity) or (p_scope is null and strpos(private.hcash_search_text(v.device_name||' '||coalesce(v.voucher,'')||' '||u.name||' '||s.name),q)>0))
  union all
  select 'return',r.id,r.device_name,s.name,r.created_at,case when public.hcash_can_cost() then to_jsonb(r) else to_jsonb(r)-'buy_price' end
  from public.device_returns r join public.shops s on s.id=r.shop_id join public.profiles u on u.id=r.actor_id
  where (adm or (r.shop_id=own and r.day_id=open_id)) and p_kind in ('all','return') and
   ((p_scope='device' and r.device_id=p_entity) or (p_scope='employee' and r.actor_id=p_entity) or (p_scope is null and strpos(private.hcash_search_text(r.device_name||' '||r.reason||' '||u.name||' '||s.name),q)>0))
 ), ranked as (
  select *,row_number() over(partition by kind order by at desc nulls last,title,id) rn,count(*) over(partition by kind) total from candidates
 ), selected as (select * from ranked where rn>p_offset and rn<=p_offset+page_size)
 select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'title',title,'subtitle',subtitle,'at',at,'record',record,'total',total) order by kind,rn),'[]'),
  'totals',(select coalesce(jsonb_object_agg(kind,total),'{}') from (select distinct kind,total from ranked) x),'page_size',page_size) into result from selected;
 return result;
end $$;
revoke all on function public.hcash_search(text,text,integer,text,uuid) from public,anon;
grant execute on function public.hcash_search(text,text,integer,text,uuid) to authenticated;
