-- Correct closing balances and retry-safe manager authorizations.
create or replace function public.hcash_approve_sale(p_owner uuid,p_actor uuid,p_sale uuid,p_device uuid,p_qty integer,p_price numeric) returns void language plpgsql security definer set search_path='' as $$
declare existing private.hcash_sale_approvals;begin
 if not exists(select 1 from public.profiles where id=p_owner and active and role='admin') or not exists(select 1 from public.profiles p join public.devices d on d.id=p_device where p.id=p_actor and p.active and p.role='cashier' and p.shop_id=d.shop_id) then raise exception 'NOT_ALLOWED';end if;
 perform pg_advisory_xact_lock(hashtextextended('hcash:approval:'||p_sale::text,0));
 select * into existing from private.hcash_sale_approvals where sale_id=p_sale;
 if found then
  if existing.actor_id<>p_actor or existing.device_id<>p_device or existing.qty<>p_qty or existing.price<>p_price then raise exception 'Request conflict';end if;
  if existing.used_at is null then update private.hcash_sale_approvals set expires_at=now()+interval '10 minutes' where sale_id=p_sale;end if;
  return;
 end if;
 insert into private.hcash_sale_approvals(sale_id,actor_id,device_id,qty,price,approved_by,expires_at) values(p_sale,p_actor,p_device,p_qty,p_price,p_owner,now()+interval '10 minutes');
 insert into public.hr_audit(actor_id,entity,row_id,after_data) values(p_owner,'sale_approval',p_sale::text,jsonb_build_object('employee_id',p_actor,'device_id',p_device,'qty',p_qty,'sell_price',p_price));
end $$;
create or replace function private.close_shop_day(p_shop uuid,p_by uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare d public.shop_days;v_in numeric;v_out numeric;n integer;s_cash numeric;s_acc numeric;s_h numeric;s_profit numeric;s_n integer;r_cash numeric;r_acc numeric;r_h numeric;r_profit numeric;r_n integer;
begin
 select * into d from public.shop_days where shop_id=p_shop and closed_at is null for update;
 if not found then return false;end if;
 update public.shop_days set closed_at=now(),closed_by=p_by where id=d.id;
 select coalesce(sum(amount) filter(where type='took'),0),coalesce(sum(amount) filter(where type='gave'),0),count(*) into v_in,v_out,n from public.txs where day_id=d.id and deleted_at is null;
 select coalesce(sum(qty*sell_price) filter(where pay='cashier'),0),coalesce(sum(qty*sell_price) filter(where pay='acc'),0),coalesce(sum(qty*sell_price) filter(where pay='hcash'),0),coalesce(sum(qty*(sell_price-buy_price)),0),coalesce(sum(qty),0) into s_cash,s_acc,s_h,s_profit,s_n from public.device_sales where day_id=d.id and deleted_at is null;
 select coalesce(sum(amount) filter(where pay='cashier'),0),coalesce(sum(amount) filter(where pay='acc'),0),coalesce(sum(amount) filter(where pay='hcash'),0),coalesce(sum(amount-case when restock then qty*buy_price else 0 end),0),coalesce(sum(qty),0) into r_cash,r_acc,r_h,r_profit,r_n from public.device_returns where day_id=d.id;
 insert into public.notes(text,kind)
 select format('%s قفل يوم %s: %s حركة، أخدت %s، أعطيت %s%s%s. أجهزة مباعة %s، مرتجعة %s، صافي مكسب %s، صافي %s %s',p.name,s.name,n,private.fmt(v_in),private.fmt(v_out),
 case when d.opening_balance is null then '' else format('. %s بدأ %s وقفل على %s',private.drawer_name(p_shop,'cashier'),private.fmt(d.opening_balance),private.fmt(d.opening_balance+v_in-v_out+s_cash-r_cash)) end,
 case when d.acc_opening is null then '' else format('. %s بدأ %s وقفل على %s',private.drawer_name(p_shop,'acc'),private.fmt(d.acc_opening),private.fmt(d.acc_opening+s_acc-r_acc)) end,
 s_n,r_n,private.fmt(s_profit-r_profit),private.drawer_name(p_shop,'hcash'),private.fmt(s_h-r_h)),'close'
 from public.profiles p,public.shops s where p.id=p_by and s.id=p_shop;
 return true;
end $$;

