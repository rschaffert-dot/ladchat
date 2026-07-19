-- ============================================================
-- Teampoäng. Varje grupps totalpoäng = summan av medlemmarnas
-- individuella poäng (group_members.points) + gruppens egna teampoäng
-- (groups.team_points). Teampoäng tjänas av laget som helhet:
--   * +20 när ett spel startas i gruppen (start_drinking_game)
--   * +10 när en Poängjakt-utmaning bekräftas i gruppen (hunt_respond)
-- award_team_points() är enda vägen in (samma mönster som
-- award_points): loggrad i team_point_events + atomisk uppdatering.
-- Vyn group_scores exponerar totalen för klienterna.
-- ============================================================

alter table public.groups
  add column if not exists team_points integer not null default 0;

create table if not exists public.team_point_events (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  amount     integer not null,
  reason     text not null,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists team_point_events_group_idx
  on public.team_point_events (group_id, created_at desc);

alter table public.team_point_events enable row level security;

drop policy if exists "team_point_events_select_member" on public.team_point_events;
create policy "team_point_events_select_member" on public.team_point_events
  for select to authenticated using (public.is_group_member(group_id));

-- ---------- Motorn ----------

create or replace function public.award_team_points(
  gid uuid, amount integer, reason text, meta jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.team_point_events (group_id, amount, reason, metadata)
    values (gid, amount, reason, meta);

  update public.groups
    set team_points = team_points + amount
    where id = gid;
end;
$$;

revoke all on function public.award_team_points(uuid, integer, text, jsonb) from public, anon, authenticated;

-- ---------- Totalvyn ----------

create or replace view public.group_scores
with (security_invoker = true) as
select
  g.id as group_id,
  coalesce(sum(gm.points), 0)::integer as member_points,
  g.team_points,
  (coalesce(sum(gm.points), 0) + g.team_points)::integer as total_points
from public.groups g
join public.group_members gm on gm.group_id = g.id
group by g.id;

grant select on public.group_scores to authenticated;

-- ---------- Spelstart ger teampoäng ----------

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

  perform public.award_team_points(
    gid, 20, 'game_started',
    jsonb_build_object('game', game_name, 'started_by', auth.uid())
  );

  insert into public.messages (group_id, user_id, content, kind, metadata)
  values (
    gid, auth.uid(),
    '🎮 ' || game_name || ' har startat med ' || array_length(participant_ids, 1) ||
      ' spelare — alla får +10 poäng och gruppen +20 teampoäng!',
    'system',
    jsonb_build_object('game', game_name)
  );
end;
$$;

-- ---------- Bekräftad jaktutmaning ger teampoäng ----------

create or replace function public.hunt_respond(completion_id uuid, approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  comp record;
  ch record;
  pts integer;
  claimant_name text;
  witness_name text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into comp
    from public.hunt_completions
    where id = completion_id and witness_user_id = auth.uid() and status = 'pending'
    for update;
  if not found then raise exception 'no pending completion to respond to'; end if;

  select * into ch from public.hunt_challenges where id = comp.challenge_id;

  select coalesce(display_name, email, 'Någon') into claimant_name
    from public.profiles where id = comp.user_id;
  select coalesce(display_name, email, 'Någon') into witness_name
    from public.profiles where id = auth.uid();

  if approve then
    pts := ch.points
      + case when comp.bonus_claimed then coalesce(ch.bonus_points, 0) else 0 end;

    update public.hunt_completions
      set status = 'confirmed', points_awarded = pts, responded_at = now()
      where id = comp.id;

    perform public.award_points(
      comp.group_id, comp.user_id, pts, 'hunt_challenge',
      jsonb_build_object(
        'challenge_id', ch.id, 'challenge', ch.name, 'tier', ch.tier,
        'bonus', comp.bonus_claimed, 'witness', auth.uid()
      )
    );

    perform public.award_team_points(
      comp.group_id, 10, 'hunt_team_support',
      jsonb_build_object('challenge_id', ch.id, 'challenge', ch.name, 'user', comp.user_id)
    );

    insert into public.messages (group_id, user_id, content, kind, metadata)
      values (
        comp.group_id, comp.user_id,
        '🃏 ' || claimant_name || ' klarade "' || ch.name || '" i Poängjakten — +'
          || pts || ' poäng! Intygat av ' || witness_name || '. Gruppen får +10 teampoäng.',
        'system',
        jsonb_build_object('hunt_challenge_id', ch.id)
      );

    insert into public.notifications (user_id, group_id, kind, content)
      values (
        comp.user_id, comp.group_id, 'hunt_confirmed',
        '✅ ' || witness_name || ' intygade "' || ch.name || '" — +' || pts || ' poäng!'
      );
  else
    update public.hunt_completions
      set status = 'denied', responded_at = now()
      where id = comp.id;

    insert into public.notifications (user_id, group_id, kind, content)
      values (
        comp.user_id, comp.group_id, 'hunt_denied',
        '❌ ' || witness_name || ' nekade "' || ch.name || '". Du kan försöka igen.'
      );
  end if;
end;
$$;
