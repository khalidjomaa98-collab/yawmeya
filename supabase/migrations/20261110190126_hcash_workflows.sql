-- Scoped cost access, minimum sale approvals, immutable customer returns.
alter table public.devices add column min_price numeric check(min_price>=0 and min_price<'Infinity'::numeric);
alter table public.device_sales add column cancel_reason text;
create table public.hcash_staff_preferences(user_id uuid primary key references public.profiles(id),view_cost boolean not null default false);
alter table public.hcash_staff_preferences enable row level security;
revoke all on public.hcash_staff_preferences from public,anon,authenticated;
grant select,insert,update on public.hcash_staff_preferences to authenticated;
grant all on public.hcash_staff_preferences to service_role;
create policy prefs_read on public.hcash_staff_preferences for select to authenticated using(public.is_admin() or user_id=(select auth.uid()));
create policy prefs_insert on public.hcash_staff_preferences for insert to authenticated with check(public.is_admin());
create policy prefs_update on public.hcash_staff_preferences for update to authenticated using(public.is_admin()) with check(public.is_admin());
-- Preserve existing visibility until the owner changes it. New users default hidden.
insert into public.hcash_staff_preferences(user_id,view_cost) select id,true from public.profiles where role='cashier';
create function public.hcash_can_cost() returns boolean language sql stable security definer set search_path='' as $$
 select public.is_admin() or (public.is_active_user() and coalesce((select view_cost from public.hcash_staff_preferences where user_id=auth.uid()),false))
$$;
revoke all on function public.hcash_can_cost() from public,anon;grant execute on function public.hcash_can_cost() to authenticated;
create function private.hcash_redact_sale(doc jsonb) returns jsonb language sql stable security definer set search_path='' as $$ select case when public.hcash_can_cost() then doc else doc-'buy_price' end $$;
revoke all on function private.hcash_redact_sale(jsonb) from public,anon,authenticated;
create policy devices_cost_guard on public.devices as restrictive for select to authenticated using(public.hcash_can_cost());
create policy sales_cost_guard on public.device_sales as restrictive for select to authenticated using(public.hcash_can_cost());
create function public.hcash_catalog_page(p_offset integer default 0,p_limit integer default 500) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role in ('admin','cashier')) then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(case when public.hcash_can_cost() then to_jsonb(x) else to_jsonb(x)-'buy_price' end),'[]') from (select * from public.devices where not archived and (public.is_admin() or shop_id=public.my_shop()) order by name,id limit greatest(1,least(p_limit,500)) offset greatest(p_offset,0))x);
end $$;
create function public.hcash_sales_page(p_offset integer default 0,p_limit integer default 500) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role='cashier') then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(private.hcash_redact_sale(to_jsonb(x))),'[]') from (select * from public.device_sales where shop_id=public.my_shop() and day_id=public.my_open_day() order by ts desc,id limit greatest(1,least(p_limit,500)) offset greatest(p_offset,0))x);
end $$;
revoke all on function public.hcash_catalog_page(integer,integer),public.hcash_sales_page(integer,integer) from public,anon;grant execute on function public.hcash_catalog_page(integer,integer),public.hcash_sales_page(integer,integer) to authenticated;
create table private.hcash_sale_approvals(sale_id uuid primary key,actor_id uuid not null references public.profiles(id),device_id uuid not null references public.devices(id),qty integer not null check(qty>0),price numeric not null check(price>=0 and price<'Infinity'::numeric),approved_by uuid not null references public.profiles(id),expires_at timestamptz not null,used_at timestamptz);
alter table private.hcash_sale_approvals enable row level security;
revoke all on private.hcash_sale_approvals from public,anon,authenticated;grant all on private.hcash_sale_approvals to service_role;
create function public.hcash_approve_sale(p_owner uuid,p_actor uuid,p_sale uuid,p_device uuid,p_qty integer,p_price numeric) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=p_owner and active and role='admin') or not exists(select 1 from public.profiles p join public.devices d on d.id=p_device where p.id=p_actor and p.active and p.role='cashier' and p.shop_id=d.shop_id) then raise exception 'NOT_ALLOWED';end if;
 insert into private.hcash_sale_approvals(sale_id,actor_id,device_id,qty,price,approved_by,expires_at) values(p_sale,p_actor,p_device,p_qty,p_price,p_owner,now()+interval '10 minutes');
 insert into public.hr_audit(actor_id,entity,row_id,after_data) values(p_owner,'sale_approval',p_sale::text,jsonb_build_object('employee_id',p_actor,'device_id',p_device,'qty',p_qty,'sell_price',p_price));
end $$;
revoke all on function public.hcash_approve_sale(uuid,uuid,uuid,uuid,integer,numeric) from public,anon,authenticated;grant execute on function public.hcash_approve_sale(uuid,uuid,uuid,uuid,integer,numeric) to service_role;
create function private.hcash_enforce_price() returns trigger language plpgsql security definer set search_path='' as $$
declare floor_price numeric;begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role in ('admin','cashier')) then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 select min_price into floor_price from public.devices where id=new.device_id;
 if not public.is_admin() and floor_price is not null and new.sell_price<floor_price then
  update private.hcash_sale_approvals set used_at=now() where sale_id=new.id and actor_id=auth.uid() and device_id=new.device_id and qty=new.qty and price=new.sell_price and expires_at>now() and used_at is null;
  if not found then raise exception 'MIN_PRICE_APPROVAL' using errcode='42501';end if;
 end if;return new;
end $$;
revoke all on function private.hcash_enforce_price() from public,anon,authenticated;
create trigger hcash_enforce_price before insert on public.device_sales for each row execute function private.hcash_enforce_price();
do $redact$ declare d text;begin
 select pg_get_functiondef('public.hcash_post_sale(uuid,uuid,integer,numeric,text,text)'::regprocedure) into d;
 d:=replace(d,'return receipt.response||','return private.hcash_redact_sale(receipt.response)||');
 d:=replace(d,'return to_jsonb(x)||','return private.hcash_redact_sale(to_jsonb(x))||');execute d;
end $redact$;
create table public.device_returns(
 id uuid primary key,created_at timestamptz not null default now(),sale_id uuid not null references public.device_sales(id),shop_id uuid not null references public.shops(id),day_id uuid not null references public.shop_days(id),device_id uuid references public.devices(id),device_name text not null,qty integer not null check(qty>0),amount numeric not null check(amount>=0 and amount<'Infinity'::numeric),buy_price numeric not null,restock boolean not null,pay text not null check(pay in ('cashier','acc','hcash')),reason text not null check(length(btrim(reason))>=3),actor_id uuid not null references public.profiles(id)
);
alter table public.device_returns enable row level security;
revoke all on public.device_returns from public,anon,authenticated;grant select on public.device_returns to authenticated;grant all on public.device_returns to service_role;
create policy returns_read on public.device_returns for select to authenticated using(public.is_admin() or (public.hcash_can_cost() and public.is_active_user() and shop_id=public.my_shop() and day_id=public.my_open_day()));
create index device_returns_sale_idx on public.device_returns(sale_id);create index device_returns_day_idx on public.device_returns(day_id);
create trigger device_returns_immutable before update or delete on public.device_returns for each row execute function private.hr_append_only();
create trigger device_returns_audit after insert on public.device_returns for each row execute function private.business_audit_row();
create trigger hcash_preferences_audit after insert or update on public.hcash_staff_preferences for each row execute function private.business_audit_row();
create function public.hcash_returns_page(p_offset integer default 0,p_limit integer default 500) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role in ('admin','cashier')) then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(private.hcash_redact_sale(to_jsonb(x))),'[]') from (select * from public.device_returns where public.is_admin() or (shop_id=public.my_shop() and day_id=public.my_open_day()) order by created_at desc,id limit greatest(1,least(p_limit,500)) offset greatest(p_offset,0))x);
end $$;
create function public.hcash_return_sale(p_id uuid,p_sale uuid,p_qty integer,p_amount numeric,p_restock boolean,p_pay text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.device_sales; r public.device_returns; d uuid;returned integer;begin
 if not public.is_admin() then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 if p_id is null or p_qty is null or p_qty<1 or p_amount is null or p_amount<0 or p_amount>='Infinity'::numeric or p_restock is null or length(btrim(coalesce(p_reason,'')))<3 then raise exception 'BAD_RETURN' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('hcash:return:'||p_id::text,0));
 select * into r from public.device_returns where id=p_id;
 if found then
  if r.sale_id is distinct from p_sale or r.qty<>p_qty or r.amount<>p_amount or r.restock<>p_restock or r.pay is distinct from p_pay or r.reason<>btrim(p_reason) then raise exception 'Request conflict' using errcode='22023';end if;
  return to_jsonb(r);
 end if;
 select * into s from public.device_sales where id=p_sale for update;
 if not found or s.deleted_at is not null then raise exception 'NO_SALE' using errcode='22023';end if;
 select coalesce(sum(qty),0) into returned from public.device_returns where sale_id=p_sale;
 if p_qty>s.qty-returned or p_amount>round(s.sell_price*p_qty,2) then raise exception 'RETURN_LIMIT' using errcode='22023';end if;
 if p_restock and s.device_id is null then raise exception 'NO_DEVICE' using errcode='22023';end if;
 if not exists(select 1 from public.shop_drawers where shop_id=s.shop_id and key=p_pay and active) then raise exception 'BAD_PAY' using errcode='22023';end if;
 select id into d from public.shop_days where shop_id=s.shop_id and closed_at is null;
 if d is null then insert into public.shop_days(shop_id,opened_by) values(s.shop_id,auth.uid()) on conflict (shop_id) where closed_at is null do nothing; select id into d from public.shop_days where shop_id=s.shop_id and closed_at is null;end if;
 insert into public.device_returns(id,sale_id,shop_id,day_id,device_id,device_name,qty,amount,buy_price,restock,pay,reason,actor_id) values(p_id,p_sale,s.shop_id,d,s.device_id,s.device_name,p_qty,p_amount,s.buy_price,p_restock,p_pay,btrim(p_reason),auth.uid()) returning * into r;
 if p_restock then update public.devices set qty=qty+p_qty where id=s.device_id;end if;
 insert into public.notes(kind,text) values('return',format('مرتجع %s × %s · %s من %s · %s',s.device_name,p_qty,private.fmt(p_amount),private.drawer_name(s.shop_id,p_pay),btrim(p_reason)));
 return to_jsonb(r);
end $$;
revoke all on function public.hcash_returns_page(integer,integer),public.hcash_return_sale(uuid,uuid,integer,numeric,boolean,text,text) from public,anon;grant execute on function public.hcash_returns_page(integer,integer),public.hcash_return_sale(uuid,uuid,integer,numeric,boolean,text,text) to authenticated;
create function public.hcash_cancel_sale(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare s public.device_sales;begin
 if length(btrim(coalesce(p_reason,'')))<3 then raise exception 'REASON_REQUIRED' using errcode='22023';end if;
 select * into s from public.device_sales where id=p_id for update;
 if not found then raise exception 'NO_SALE';end if;
 if exists(select 1 from public.device_returns where sale_id=p_id) then raise exception 'HAS_RETURN' using errcode='22023';end if;
 perform public.delete_sale(p_id);update public.device_sales set cancel_reason=btrim(p_reason) where id=p_id;
end $$;
revoke all on function public.hcash_cancel_sale(uuid,text) from public,anon;grant execute on function public.hcash_cancel_sale(uuid,text) to authenticated;
do $cancel$ declare d text;begin
 select pg_get_functiondef('public.delete_sale(uuid)'::regprocedure) into d;
 d:=replace(d,'if x.deleted_at is not null then return; end if;','if x.deleted_at is not null then return; end if; if exists(select 1 from public.device_returns where sale_id=p_id) then raise exception ''HAS_RETURN'';end if;');execute d;
end $cancel$;
create table public.hcash_signals(id boolean primary key default true check(id),revision bigint not null default 0);
insert into public.hcash_signals default values;
alter table public.hcash_signals enable row level security;revoke all on public.hcash_signals from public,anon,authenticated;grant select on public.hcash_signals to authenticated;
create policy signals_read on public.hcash_signals for select to authenticated using(public.is_active_user());
create function private.hcash_signal() returns trigger language plpgsql security definer set search_path='' as $$ begin update public.hcash_signals set revision=revision+1 where id;return null;end $$;
revoke all on function private.hcash_signal() from public,anon,authenticated;
create trigger hcash_device_signal after insert or update or delete on public.devices for each statement execute function private.hcash_signal();
create trigger hcash_sale_signal after insert or update or delete on public.device_sales for each statement execute function private.hcash_signal();
create trigger hcash_return_signal after insert on public.device_returns for each statement execute function private.hcash_signal();
create trigger hcash_pref_signal after insert or update on public.hcash_staff_preferences for each statement execute function private.hcash_signal();
alter publication supabase_realtime add table public.hcash_signals;
do $backup$ declare d text;signature text;begin
 foreach signature in array array['public.hcash_backup_snapshot()','public.hcash_check_backup(jsonb)'] loop
  select pg_get_functiondef(signature::regprocedure) into d;
  d:=replace(d,'''hr_audit'',''hcash_receipts''','''hr_audit'',''hcash_receipts'',''device_returns'',''hcash_staff_preferences''');
  if signature='public.hcash_backup_snapshot()' then d:=replace(d,'''schema_version'',2','''schema_version'',3');else
   d:=replace(d,'''1'',''2''','''1'',''2'',''3''');
   d:=replace(d,'foreach t in array tables loop','if not (p_doc->''tables'' ? ''device_returns'') then p_doc:=jsonb_set(p_doc,''{tables,device_returns}'',''[]''::jsonb);end if; if not (p_doc->''tables'' ? ''hcash_staff_preferences'') then p_doc:=jsonb_set(p_doc,''{tables,hcash_staff_preferences}'',''[]''::jsonb);end if; foreach t in array tables loop');
  end if;execute d;
 end loop;
end $backup$;
-- Immutable returns retain their original sale even through an owner archive/wipe.
do $wipe$ declare d text;begin
 select pg_get_functiondef('public.hcash_owner_wipe(uuid,jsonb)'::regprocedure) into d;
 d:=replace(d,'where live.id=saved.id and to_jsonb(live)=to_jsonb(saved);get diagnostics ns=row_count;', 'where live.id=saved.id and to_jsonb(live)=to_jsonb(saved) and not exists(select 1 from public.device_returns r where r.sale_id=live.id);get diagnostics ns=row_count;');execute d;
end $wipe$;

