-- Cancellation is exposed only through the scoped, reason-required wrapper.
revoke execute on function public.delete_sale(uuid) from public,anon,authenticated;
