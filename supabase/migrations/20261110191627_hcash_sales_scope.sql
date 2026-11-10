create or replace function public.hcash_sales_page(p_offset integer default 0,p_limit integer default 500) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role in ('admin','cashier')) then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(private.hcash_redact_sale(to_jsonb(x))),'[]') from (select s.* from public.device_sales s where (public.is_admin() and (s.ts >= ((public.cairo_today()-45)::timestamp at time zone 'Africa/Cairo') or exists(select 1 from public.shop_days d where d.id=s.day_id and d.closed_at is null))) or (not public.is_admin() and s.shop_id=public.my_shop() and s.day_id=public.my_open_day()) order by s.ts desc,s.id limit greatest(1,least(p_limit,500)) offset greatest(p_offset,0))x);
end $$;
create or replace function public.hcash_cancel_sale(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare s public.device_sales;begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role in ('admin','cashier')) then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 if length(btrim(coalesce(p_reason,'')))<3 then raise exception 'REASON_REQUIRED' using errcode='22023';end if;
 select * into s from public.device_sales where id=p_id for update;
 if not found then raise exception 'NO_SALE';end if;
 if not public.is_admin() and (s.user_id is distinct from auth.uid() or s.day_id is distinct from public.my_open_day()) then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 if exists(select 1 from public.device_returns where sale_id=p_id) then raise exception 'HAS_RETURN' using errcode='22023';end if;
 perform public.delete_sale(p_id);update public.device_sales set cancel_reason=btrim(p_reason) where id=p_id;
end $$;

