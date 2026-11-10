create table public.hcash_receipts(id uuid primary key,actor_id uuid not null references public.profiles(id),kind text not null check(kind in ('tx','sale')),payload jsonb not null,response jsonb not null,created_at timestamptz not null default now());
alter table public.hcash_receipts enable row level security;
revoke all on public.hcash_receipts from public,anon,authenticated;
create trigger hcash_receipts_immutable before update or delete on public.hcash_receipts for each row execute function private.hr_append_only();
do $patch$ declare definition text; signature text; kind text; payload text; begin
 foreach kind in array array['tx','sale'] loop
  signature:=case when kind='tx' then 'public.hcash_post_tx(uuid,uuid,uuid,text,text,numeric,text)' else 'public.hcash_post_sale(uuid,uuid,integer,numeric,text,text)' end;
  payload:=case when kind='tx' then 'jsonb_build_object(''shop'',p_shop,''party'',p_party,''name'',p_name,''type'',p_type,''amount'',p_amount,''note'',coalesce(p_note,''''))' else 'jsonb_build_object(''device'',p_device,''qty'',p_qty,''price'',p_price,''pay'',p_pay,''voucher'',coalesce(nullif(btrim(p_voucher),''''),''''))' end;
  select pg_get_functiondef(signature::regprocedure) into definition;
  definition:=replace(definition,'declare x public.', 'declare receipt public.hcash_receipts; input jsonb; x public.');
  definition:=replace(definition,case when kind='tx' then 'select * into x from public.txs where id=p_id;' else 'select * into x from public.device_sales where id=p_id;' end,
    'input:='||payload||'; select * into receipt from public.hcash_receipts where id=p_id; if found then if receipt.actor_id<>auth.uid() or receipt.kind<>'||quote_literal(kind)||' or receipt.payload<>input then raise exception ''Request conflict'' using errcode=''22023'';end if;return receipt.response||jsonb_build_object(''_receipt_replayed'',true);end if; '||
    case when kind='tx' then 'select * into x from public.txs where id=p_id;' else 'select * into x from public.device_sales where id=p_id;' end);
  definition:=replace(definition,'return to_jsonb(x);','insert into public.hcash_receipts(id,actor_id,kind,payload,response) values(p_id,auth.uid(),'||quote_literal(kind)||',input,to_jsonb(x)); return to_jsonb(x)||jsonb_build_object(''_receipt_replayed'',false);');
  execute definition;
 end loop;
 foreach signature in array array['public.hcash_backup_snapshot()','public.hcash_check_backup(jsonb)'] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  execute replace(definition,'''hr_commands'',''hr_audit''','''hr_commands'',''hr_audit'',''hcash_receipts''');
 end loop;
end $patch$;
