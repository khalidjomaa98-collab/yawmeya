-- Keep legacy cash transactions and outstanding receipts compatible.
alter table public.txs add column drawer text not null default 'cashier' check(drawer in ('cashier','acc'));

CREATE OR REPLACE FUNCTION private.txs_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare own uuid; d public.shop_days;
begin
  new.ts := now();
  new.user_id := auth.uid();
  new.deleted_at := null; new.deleted_by := null; new.delete_reason := null;
  new.transferred_at := null; new.delete_ack := false;
  new.method := null; new.after_close := false;
  new.note := coalesce(trim(new.note), '');
  if not public.is_admin() then
    own := public.my_shop();
    if own is null then raise exception 'NO_SHOP'; end if;
    new.shop_id := own;
  end if;
  if new.drawer = 'acc' then
    perform 1 from public.shop_drawers where shop_id=new.shop_id and key='acc' and active for share;
    if not found then raise exception 'BAD_DRAWER' using errcode='22023'; end if;
  end if;
  if new.party_id is null or not exists(select 1 from public.parties where id = new.party_id) then
    raise exception 'PARTY_REQUIRED';
  end if;
  loop
    select * into d from public.shop_days where shop_id = new.shop_id and closed_at is null for update;
    exit when found;
    insert into public.shop_days(shop_id, opened_by) values (new.shop_id, auth.uid())
      on conflict (shop_id) where closed_at is null do nothing;
  end loop;
  new.day_id := d.id;
  new.day := (d.opened_at at time zone 'Africa/Cairo')::date;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.txs_after_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists(select 1 from public.profiles where id = new.user_id and role = 'admin') then
    insert into public.notes(text, kind)
    select format('%s: %s %s %s (%s · %s)', p.name, private.type_label(new.type),
                  case new.type when 'took' then 'من' else 'لـ' end || ' ' || pa.name, private.fmt(new.amount), s.name, private.drawer_name(new.shop_id,new.drawer)), 'tx'
    from public.profiles p, public.shops s, public.parties pa
    where p.id = new.user_id and s.id = new.shop_id and pa.id = new.party_id;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.hcash_post_drawer_tx(p_id uuid, p_shop uuid, p_party uuid, p_name text, p_type text, p_amount numeric, p_note text, p_drawer text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare receipt public.hcash_receipts; input jsonb; x public.txs; s uuid;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role in ('admin','cashier')) then raise exception 'NOT_ALLOWED' using errcode='42501';end if;
 if p_id is null or p_party is null or p_type is null or p_type not in ('took','gave') or p_drawer is distinct from 'acc' or p_amount is null or p_amount<=0 or p_amount>='Infinity'::numeric then raise exception 'Invalid transaction' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('hcash:tx:'||p_id::text,0));
 input:=jsonb_build_object('drawer',p_drawer,'shop',p_shop,'party',p_party,'name',p_name,'type',p_type,'amount',p_amount,'note',coalesce(p_note,'')); select * into receipt from public.hcash_receipts where id=p_id; if found then if receipt.actor_id<>auth.uid() or receipt.kind<>'tx' or receipt.payload<>input then raise exception 'Request conflict' using errcode='22023';end if;return receipt.response||jsonb_build_object('_receipt_replayed',true);end if; select * into x from public.txs where id=p_id;
 if found then
  if x.drawer is distinct from p_drawer or x.user_id<>auth.uid() or x.shop_id is distinct from p_shop or x.party_id is distinct from p_party or x.type<>p_type or x.amount<>p_amount or coalesce(x.note,'')<>coalesce(p_note,'') then raise exception 'Request conflict' using errcode='22023';end if;
  insert into public.hcash_receipts(id,actor_id,kind,payload,response) values(p_id,auth.uid(),'tx',input,to_jsonb(x)); return to_jsonb(x)||jsonb_build_object('_receipt_replayed',false);
 end if;
 s:=case when public.is_admin() then p_shop else public.my_shop() end;
 if s is null or s is distinct from p_shop then raise exception 'NO_SHOP' using errcode='42501';end if;
 if not exists(select 1 from public.parties where id=p_party) then
  if coalesce(btrim(p_name),'')='' then raise exception 'PARTY_REQUIRED' using errcode='22023';end if;
  insert into public.parties(id,kind,name) values(p_party,'customer',btrim(p_name));
 end if;
 insert into public.txs(id,shop_id,type,party_id,amount,note,drawer) values(p_id,s,p_type,p_party,p_amount,coalesce(p_note,''),p_drawer) returning * into x;
 insert into public.hcash_receipts(id,actor_id,kind,payload,response) values(p_id,auth.uid(),'tx',input,to_jsonb(x)); return to_jsonb(x)||jsonb_build_object('_receipt_replayed',false);
end $function$;
revoke all on function public.hcash_post_drawer_tx(uuid,uuid,uuid,text,text,numeric,text,text) from public,anon;
grant execute on function public.hcash_post_drawer_tx(uuid,uuid,uuid,text,text,numeric,text,text) to authenticated;

CREATE OR REPLACE FUNCTION private.close_shop_day(p_shop uuid, p_by uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.shop_days;v_in numeric;v_out numeric;a_in numeric;a_out numeric;n integer;s_cash numeric;s_acc numeric;s_h numeric;s_profit numeric;s_n integer;r_cash numeric;r_acc numeric;r_h numeric;r_profit numeric;r_n integer;
begin
 select * into d from public.shop_days where shop_id=p_shop and closed_at is null for update;
 if not found then return false;end if;
 update public.shop_days set closed_at=now(),closed_by=p_by where id=d.id;
 select coalesce(sum(amount) filter(where type='took'),0),coalesce(sum(amount) filter(where type='gave'),0),coalesce(sum(amount) filter(where type='took' and drawer='acc'),0),coalesce(sum(amount) filter(where type='gave' and drawer='acc'),0),count(*) into v_in,v_out,a_in,a_out,n from public.txs where day_id=d.id and deleted_at is null;
 select coalesce(sum(qty*sell_price) filter(where pay='cashier'),0),coalesce(sum(qty*sell_price) filter(where pay='acc'),0),coalesce(sum(qty*sell_price) filter(where pay='hcash'),0),coalesce(sum(qty*(sell_price-buy_price)),0),coalesce(sum(qty),0) into s_cash,s_acc,s_h,s_profit,s_n from public.device_sales where day_id=d.id and deleted_at is null;
 select coalesce(sum(amount) filter(where pay='cashier'),0),coalesce(sum(amount) filter(where pay='acc'),0),coalesce(sum(amount) filter(where pay='hcash'),0),coalesce(sum(amount-case when restock then qty*buy_price else 0 end),0),coalesce(sum(qty),0) into r_cash,r_acc,r_h,r_profit,r_n from public.device_returns where day_id=d.id;
 insert into public.notes(text,kind)
 select format('%s قفل يوم %s: %s حركة، أخدت %s، أعطيت %s%s%s. أجهزة مباعة %s، مرتجعة %s، صافي مكسب %s، صافي %s %s',p.name,s.name,n,private.fmt(v_in),private.fmt(v_out),
 case when d.opening_balance is null then '' else format('. %s بدأ %s وقفل على %s',private.drawer_name(p_shop,'cashier'),private.fmt(d.opening_balance),private.fmt(d.opening_balance+v_in-v_out-a_in+a_out+s_cash-r_cash)) end,
 case when d.acc_opening is null then '' else format('. %s بدأ %s وقفل على %s',private.drawer_name(p_shop,'acc'),private.fmt(d.acc_opening),private.fmt(d.acc_opening+a_in-a_out+s_acc-r_acc)) end,
 s_n,r_n,private.fmt(s_profit-r_profit),private.drawer_name(p_shop,'hcash'),private.fmt(s_h-r_h)),'close'
 from public.profiles p,public.shops s where p.id=p_by and s.id=p_shop;
 return true;
end $function$;

-- Personal notes are visible to management and the addressed active account.
alter table public.notes add column recipient_id uuid references public.profiles(id);
create index notes_recipient_ts on public.notes(recipient_id,ts desc) where recipient_id is not null;
alter policy notes_read on public.notes using ((select public.is_admin()) or
  (recipient_id=(select auth.uid()) and (select public.hr_active())));

create function public.hcash_send_message(p_id uuid,p_recipient uuid,p_text text) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous public.notes; message text:=btrim(p_text);
begin
 if not public.is_admin() or not public.hr_active() then raise exception 'NOT_ALLOWED' using errcode='42501'; end if;
 if p_id is null or coalesce(length(message),0) not between 1 and 500 then
   raise exception 'INVALID_MESSAGE' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('hcash:message:'||p_id::text,0));
 select * into previous from public.notes where id=p_id;
 if found then
   if previous.kind='personal' and previous.recipient_id=p_recipient and previous.text=message then return p_id; end if;
   raise exception 'Request conflict' using errcode='22023';
 end if;
 perform 1 from public.profiles where id=p_recipient and active and role in ('cashier','staff') for share;
 if not found then raise exception 'MESSAGE_RECIPIENT' using errcode='22023'; end if;
 insert into public.notes(id,recipient_id,text,kind) values(p_id,p_recipient,message,'personal');
 return p_id;
end $$;
revoke all on function public.hcash_send_message(uuid,uuid,text) from public,anon;
grant execute on function public.hcash_send_message(uuid,uuid,text) to authenticated;

create function public.hcash_read_messages(p_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.hr_active() then raise exception 'NOT_ALLOWED' using errcode='42501'; end if;
 update public.notes set read=true where recipient_id=auth.uid() and kind='personal' and not read and id=any(p_ids);
end $$;
revoke all on function public.hcash_read_messages(uuid[]) from public,anon;
grant execute on function public.hcash_read_messages(uuid[]) to authenticated;

do $compatibility$
declare definition text;
begin
 select pg_get_functiondef('public.hcash_ledger_snapshot()'::regprocedure) into definition;
 execute replace(definition,'from public.notes where adm order by','from public.notes where adm or recipient_id=auth.uid() order by');
 select pg_get_functiondef('public.hcash_check_backup(jsonb)'::regprocedure) into definition;
 execute replace(definition,'foreach t in array tables loop',
   'if jsonb_typeof(p_doc->''tables''->''txs'')=''array'' then p_doc:=jsonb_set(p_doc,''{tables,txs}'',(select coalesce(jsonb_agg(jsonb_build_object(''drawer'',''cashier'')||value),''[]'') from jsonb_array_elements(p_doc->''tables''->''txs'')));end if; foreach t in array tables loop');
 select pg_get_functiondef('public.hcash_owner_wipe(uuid,jsonb)'::regprocedure) into definition;
 execute replace(replace(definition,'where live.id=saved.id and to_jsonb(live)=to_jsonb(saved);get diagnostics nn',
   'where live.recipient_id is null and live.id=saved.id and to_jsonb(live)=to_jsonb(saved);get diagnostics nn'),
   '(select count(*) from public.notes)', '(select count(*) from public.notes where recipient_id is null)');
end $compatibility$;

-- Disable new employee pauses while retaining existing attendance history.
do $patch$
declare definition text; anchor text:='if p_request_id is null or p_action is null';
begin
 select pg_get_functiondef('public.hr_command(text,jsonb,uuid)'::regprocedure) into definition;
 if position(anchor in definition)=0 then raise exception 'Attendance guard missing'; end if;
 execute replace(definition,anchor,'if p_action=''pause'' then raise exception ''PAUSE_DISABLED'' using errcode=''22023''; end if;'||E'\n '||anchor);
end $patch$;

-- Keep the actual shift timestamps alongside the daily portion used for pay.
do $report_segments$
declare definition text;
begin
 select pg_get_functiondef('private.hr_calculate(uuid,date,date,jsonb)'::regprocedure) into definition;
 if position('select s.id, d::date AS day' in definition)=0 then raise exception 'Payroll segment source missing'; end if;
 definition:=replace(definition,'select s.id, d::date AS day','select s.id, s.start_at attendance_start, s.end_at attendance_end, d::date AS day');
 definition:=replace(definition,'segments:=segments||jsonb_build_array','end if; segments:=segments||jsonb_build_array');
 definition:=regexp_replace(definition,'''hourly_rate'',r.hourly_rate\)\);\s+end if;',
   '''hourly_rate'',r.hourly_rate,''attendance_start'',r.attendance_start,''attendance_end'',r.attendance_end));');
 execute definition;
end $report_segments$;

create function public.hr_period_report(p_employee uuid,p_start date,p_end date,p_adjustments jsonb default '[]') returns jsonb
language plpgsql security definer set search_path='' as $$
declare calculation jsonb;
begin
 if not public.is_admin() or not public.hr_active() then raise exception 'NOT_ALLOWED' using errcode='42501'; end if;
 if not exists(select 1 from public.profiles where id=p_employee and role in ('cashier','staff')) then
   raise exception 'Employee required' using errcode='22023';
 end if;
 if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) then
   raise exception 'Invalid report dates' using errcode='22023';
 end if;
 if p_end<p_start or p_end-p_start>365 then raise exception 'Invalid report dates' using errcode='22023'; end if;
 calculation:=private.hr_calculate(p_employee,p_start,p_end,p_adjustments);
 return calculation||jsonb_build_object('employee_id',p_employee,'period_start',p_start,'period_end',p_end,
   'status','preview','snapshot',calculation);
end $$;
revoke all on function public.hr_period_report(uuid,date,date,jsonb) from public,anon;
grant execute on function public.hr_period_report(uuid,date,date,jsonb) to authenticated;
