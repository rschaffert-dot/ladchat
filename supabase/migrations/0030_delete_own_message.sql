-- ============================================================
-- Ta bort eget meddelande (långtrycksmenyn i chatten). Replica
-- identity full krävs för att realtime-DELETE ska bära hela raden så
-- att klientens group_id-filter träffar (samma grepp som reactions).
-- ============================================================

drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own" on public.messages
  for delete to authenticated
  using (user_id = auth.uid());

alter table public.messages replica identity full;
