-- Härda SECURITY DEFINER-funktioner efter säkerhetsrådgivning.

-- Trigger-funktionen ska inte exponeras som RPC (triggern kör ändå som tabellägare).
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Hjälpfunktioner behövs bara av authenticated (alla policyer är to authenticated).
revoke execute on function public.is_group_member(uuid)  from anon;
revoke execute on function public.shares_group_with(uuid) from anon;
