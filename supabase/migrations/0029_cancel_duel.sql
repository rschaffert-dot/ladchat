-- ============================================================
-- Avbryt skickad duellutmaning. Utmanaren kan dra tillbaka en duell
-- så länge den är pending — insatserna dras först vid accept, så
-- ingen poängåterbetalning behövs. Statusen 'declined' återanvänds
-- (den betyder "blev aldrig av"), vilket också släpper spärren
-- "duel already in progress" i create_duel.
-- ============================================================

create or replace function public.cancel_duel(did uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.duels%rowtype;
  my_name text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into d from public.duels where id = did for update;
  if d.id is null then raise exception 'duel not found'; end if;
  if d.challenger_id <> auth.uid() then raise exception 'only the challenger can cancel'; end if;
  if d.status <> 'pending' then raise exception 'duel not pending'; end if;

  update public.duels set status = 'declined' where id = did;

  select coalesce(display_name, email, '?') into my_name
    from public.profiles where id = auth.uid();
  perform public.duel_system_message(
    d.group_id, auth.uid(),
    '↩️ ' || my_name || ' drog tillbaka duellutmaningen.',
    did
  );
end;
$$;

revoke all on function public.cancel_duel(uuid) from public, anon;
grant execute on function public.cancel_duel(uuid) to authenticated;
