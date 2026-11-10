-- Financial entrypoints deliberately exclude attendance-only staff, even if a shop is later assigned.
do $roles$ declare signature text; definition text; begin
 foreach signature in array array['public.hcash_post_tx(uuid,uuid,uuid,text,text,numeric,text)','public.hcash_post_sale(uuid,uuid,integer,numeric,text,text)'] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  definition:=replace(definition,'if not public.is_active_user() then', 'if not exists(select 1 from public.profiles where id=auth.uid() and active and role in (''admin'',''cashier'')) then');
  execute definition;
 end loop;
end $roles$;
