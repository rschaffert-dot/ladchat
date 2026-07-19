-- ============================================================
-- Spel i chatten (Kings Cup m.fl.). Själva spelet körs lokalt på en
-- telefon som skickas runt bordet — servern registrerar bara starten:
-- alla ibockade deltagare får 10 poäng via poängmotorn och ett
-- systemmeddelande postas i chatten.
-- ============================================================

create or replace function public.start_drinking_game(gid uuid, game_name text, participant_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;
  if participant_ids is null or array_length(participant_ids, 1) < 2 then
    raise exception 'games need at least 2 participants';
  end if;

  foreach pid in array participant_ids loop
    if not exists (
      select 1 from public.group_members where group_id = gid and user_id = pid
    ) then
      raise exception 'participant not a member';
    end if;
  end loop;

  foreach pid in array participant_ids loop
    perform public.award_points(
      gid, pid, 10, 'game_participation',
      jsonb_build_object('game', game_name, 'started_by', auth.uid())
    );
  end loop;

  insert into public.messages (group_id, user_id, content, kind, metadata)
  values (
    gid, auth.uid(),
    '🎮 ' || game_name || ' har startat med ' || array_length(participant_ids, 1) ||
      ' spelare — alla får +10 poäng för närvaro!',
    'system',
    jsonb_build_object('game', game_name)
  );
end;
$$;

revoke all on function public.start_drinking_game(uuid, text, uuid[]) from public, anon;
grant execute on function public.start_drinking_game(uuid, text, uuid[]) to authenticated;
