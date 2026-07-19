-- ============================================================
-- En topplista måste vara synlig för alla deltagare, inte bara det egna
-- laget. Öppnar upp läsning av anmälningar (poäng) och gruppnamn för
-- lag som faktiskt deltar i en turnering.
-- ============================================================

create policy "entries_select_all" on public.tournament_entries for select to authenticated
  using (true);

create policy "groups_select_tournament_entrant" on public.groups for select to authenticated
  using (
    exists (
      select 1 from public.tournament_entries e
      where e.group_id = groups.id
    )
  );
