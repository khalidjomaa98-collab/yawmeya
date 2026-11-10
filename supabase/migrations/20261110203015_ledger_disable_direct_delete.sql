-- Individual ledger entries are cancelled, not physically deleted by clients.
-- The existing owner wipe remains behind its backup/PIN service entry point.
revoke delete on public.txs from public,anon,authenticated;
