do $patch$ declare definition text;begin
 select pg_get_functiondef('public.hcash_backup_snapshot()'::regprocedure) into definition;
 execute replace(definition,'''schema_version'',1','''schema_version'',2');
 select pg_get_functiondef('public.hcash_check_backup(jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'if p_doc->>''schema_version''<>''1''','if coalesce(p_doc->>''schema_version'','''') not in (''1'',''2'')');
 definition:=replace(definition,'foreach t in array tables loop','if p_doc->>''schema_version''=''1'' and not (p_doc->''tables'' ? ''hcash_receipts'') then p_doc:=jsonb_set(p_doc,''{tables,hcash_receipts}'',''[]''::jsonb);end if; foreach t in array tables loop');
 execute definition;
end $patch$;
