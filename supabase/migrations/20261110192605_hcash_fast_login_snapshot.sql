-- One consistent, role-scoped startup snapshot instead of many browser round trips.
create function public.hcash_ledger_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare adm boolean;own uuid;open_day uuid;cost boolean;cutoff date:=public.cairo_today()-45;boundary timestamptz;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role in ('admin','cashier')) then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 adm:=public.is_admin();own:=public.my_shop();open_day:=public.my_open_day();cost:=public.hcash_can_cost();boundary:=cutoff::timestamp at time zone 'Africa/Cairo';
 return jsonb_build_object(
 'shops',(select coalesce(jsonb_agg(to_jsonb(s) order by s.sort,s.id),'[]') from public.shops s),
 'users',(select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at,p.id),'[]') from (select id,name,role,active,created_at,shop_id from public.profiles)p),
 'parties',(select coalesce(jsonb_agg(to_jsonb(p) order by p.name,p.id),'[]') from (select id,name,phone from public.parties)p),
 'days',(select coalesce(jsonb_agg(to_jsonb(d) order by d.opened_at desc,d.id),'[]') from public.shop_days d where (adm and (d.closed_at is null or d.opened_at>=boundary or d.closed_at>=boundary)) or (not adm and d.shop_id=own and d.closed_at is null)),
 'txs',(select coalesce(jsonb_agg(to_jsonb(t) order by t.ts desc,t.id),'[]') from public.txs t where (adm and (t.day>=cutoff or (t.transferred_at is null and t.deleted_at is null) or (t.deleted_at is not null and t.transferred_at is not null and not t.delete_ack) or exists(select 1 from public.shop_days d where d.id=t.day_id and (d.closed_at is null or d.closed_at>=boundary)))) or (not adm and t.shop_id=own and t.day_id=open_day and t.deleted_at is null)),
 'devices',(select coalesce(jsonb_agg(case when cost then to_jsonb(d) else to_jsonb(d)-'buy_price' end order by d.name,d.id),'[]') from public.devices d where not d.archived and (adm or d.shop_id=own)),
 'sales',(select coalesce(jsonb_agg(case when cost then to_jsonb(s) else to_jsonb(s)-'buy_price' end order by s.ts desc,s.id),'[]') from public.device_sales s where (adm and (s.ts>=boundary or exists(select 1 from public.shop_days d where d.id=s.day_id and (d.closed_at is null or d.closed_at>=boundary)))) or (not adm and s.shop_id=own and s.day_id=open_day)),
 'returns',(select coalesce(jsonb_agg(case when cost then to_jsonb(r) else to_jsonb(r)-'buy_price' end order by r.created_at desc,r.id),'[]') from public.device_returns r where adm or (r.shop_id=own and r.day_id=open_day)),
 'drawers',(select coalesce(jsonb_agg(to_jsonb(d) order by d.shop_id,d.key),'[]') from public.shop_drawers d),
 'notes',(select coalesce(jsonb_agg(to_jsonb(n) order by n.ts desc,n.id),'[]') from (select * from public.notes where adm order by ts desc,id limit 80)n),
 'preferences',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.hcash_staff_preferences p where adm or p.user_id=auth.uid()),
 'view_cost',cost
 );
end $$;
revoke all on function public.hcash_ledger_snapshot() from public,anon;
grant execute on function public.hcash_ledger_snapshot() to authenticated;

