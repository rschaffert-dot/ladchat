-- ============================================================
-- Funktion 7: Dueller (1v1). Utmanaren och motståndaren satsar lika
-- mycket ur sina egna poäng, gruppen röstar under 15 minuter, vinnaren
-- tar potten. All poänghantering via award_points. Systemmeddelanden
-- håller chatten uppdaterad om duellens gång.
-- ============================================================

create table public.duels (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id) on delete cascade,
  challenger_id uuid not null references auth.users(id) on delete cascade,
  opponent_id   uuid not null references auth.users(id) on delete cascade,
  stake         integer not null check (stake > 0),
  status        text not null default 'pending'
    check (status in ('pending', 'active', 'declined', 'finished')),
  winner_id     uuid references auth.users(id) on delete set null,
  ends_at       timestamptz,
  created_at    timestamptz not null default now(),
  check (challenger_id <> opponent_id)
);

create index duels_group_idx on public.duels (group_id, created_at desc);

-- group_id dubbleras här för att kunna realtime-filtrera per grupp.
create table public.duel_votes (
  duel_id   uuid not null references public.duels(id) on delete cascade,
  group_id  uuid not null references public.groups(id) on delete cascade,
  voter_id  uuid not null references auth.users(id) on delete cascade,
  voted_for uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (duel_id, voter_id)
);

alter table public.duels      enable row level security;
alter table public.duel_votes enable row level security;

create policy "duels_select_member" on public.duels for select to authenticated
  using (public.is_group_member(group_id));
create policy "duel_votes_select_member" on public.duel_votes for select to authenticated
  using (public.is_group_member(group_id));

create or replace function public.duel_system_message(gid uuid, uid uuid, msg text, did uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.messages (group_id, user_id, content, kind, metadata)
  values (gid, uid, msg, 'system', jsonb_build_object('duel_id', did));
end;
$$;

revoke all on function public.duel_system_message(uuid, uuid, text, uuid) from public, anon, authenticated;

create or replace function public.create_duel(gid uuid, opponent uuid, stake_amount integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  did      uuid;
  my_pts   integer;
  opp_pts  integer;
  my_name  text;
  opp_name text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;
  if opponent = auth.uid() then raise exception 'cannot duel yourself'; end if;
  if stake_amount is null or stake_amount <= 0 then raise exception 'invalid stake'; end if;
  if not exists (select 1 from public.group_members where group_id = gid and user_id = opponent) then
    raise exception 'opponent not a member';
  end if;
  if exists (select 1 from public.duels where group_id = gid and status in ('pending', 'active')) then
    raise exception 'duel already in progress';
  end if;

  select points into my_pts from public.group_members where group_id = gid and user_id = auth.uid();
  select points into opp_pts from public.group_members where group_id = gid and user_id = opponent;
  if my_pts < stake_amount then raise exception 'not enough points'; end if;
  if opp_pts < stake_amount then raise exception 'opponent has not enough points'; end if;

  insert into public.duels (group_id, challenger_id, opponent_id, stake)
    values (gid, auth.uid(), opponent, stake_amount)
    returning id into did;

  select coalesce(display_name, email, '?') into my_name from public.profiles where id = auth.uid();
  select coalesce(display_name, email, '?') into opp_name from public.profiles where id = opponent;
  perform public.duel_system_message(
    gid, auth.uid(),
    '⚔️ ' || my_name || ' utmanar ' || opp_name || ' på duell om ' || stake_amount || ' poäng!',
    did
  );

  return did;
end;
$$;

create or replace function public.respond_duel(did uuid, accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.duels%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into d from public.duels where id = did for update;
  if d.id is null then raise exception 'duel not found'; end if;
  if d.opponent_id <> auth.uid() then raise exception 'only the opponent can respond'; end if;
  if d.status <> 'pending' then raise exception 'duel not pending'; end if;

  if not accept then
    update public.duels set status = 'declined' where id = did;
    perform public.duel_system_message(d.group_id, auth.uid(), '🏳️ Duellen avböjdes.', did);
    return;
  end if;

  -- Insatserna dras när duellen accepteras.
  perform public.award_points(d.group_id, d.challenger_id, -d.stake, 'duel_stake', jsonb_build_object('duel_id', did));
  perform public.award_points(d.group_id, d.opponent_id,   -d.stake, 'duel_stake', jsonb_build_object('duel_id', did));

  update public.duels
    set status = 'active', ends_at = now() + interval '15 minutes'
    where id = did;

  perform public.duel_system_message(
    d.group_id, auth.uid(),
    '⚔️ Duellen är igång! Rösta på vinnaren inom 15 minuter.',
    did
  );
end;
$$;

create or replace function public.vote_duel(did uuid, target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.duels%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into d from public.duels where id = did;
  if d.id is null then raise exception 'duel not found'; end if;
  if not public.is_group_member(d.group_id) then raise exception 'not a member'; end if;
  if d.status <> 'active' then raise exception 'duel not active'; end if;
  if now() >= d.ends_at then raise exception 'voting closed'; end if;
  if auth.uid() in (d.challenger_id, d.opponent_id) then raise exception 'participants cannot vote'; end if;
  if target not in (d.challenger_id, d.opponent_id) then raise exception 'invalid target'; end if;

  insert into public.duel_votes (duel_id, group_id, voter_id, voted_for)
    values (did, d.group_id, auth.uid(), target)
    on conflict (duel_id, voter_id) do update set voted_for = excluded.voted_for;
end;
$$;

create or replace function public.settle_duel(did uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d          public.duels%rowtype;
  ch_votes   integer;
  op_votes   integer;
  win        uuid;
  win_name   text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into d from public.duels where id = did for update;
  if d.id is null then raise exception 'duel not found'; end if;
  if not public.is_group_member(d.group_id) then raise exception 'not a member'; end if;
  if d.status <> 'active' then return; end if;
  if now() < d.ends_at then raise exception 'voting still open'; end if;

  select count(*) filter (where voted_for = d.challenger_id),
         count(*) filter (where voted_for = d.opponent_id)
    into ch_votes, op_votes
    from public.duel_votes where duel_id = did;

  if ch_votes = op_votes then
    -- Oavgjort: båda får tillbaka insatsen.
    perform public.award_points(d.group_id, d.challenger_id, d.stake, 'duel_refund', jsonb_build_object('duel_id', did));
    perform public.award_points(d.group_id, d.opponent_id,   d.stake, 'duel_refund', jsonb_build_object('duel_id', did));
    update public.duels set status = 'finished', winner_id = null where id = did;
    perform public.duel_system_message(d.group_id, auth.uid(), '🤝 Duellen slutade oavgjort — insatserna går tillbaka.', did);
    return;
  end if;

  win := case when ch_votes > op_votes then d.challenger_id else d.opponent_id end;
  perform public.award_points(d.group_id, win, d.stake * 2, 'duel_win', jsonb_build_object('duel_id', did));
  update public.duels set status = 'finished', winner_id = win where id = did;

  select coalesce(display_name, email, '?') into win_name from public.profiles where id = win;
  perform public.duel_system_message(
    d.group_id, auth.uid(),
    '🏆 ' || win_name || ' vann duellen och tar potten på ' || (d.stake * 2) || ' poäng!',
    did
  );
end;
$$;

revoke all on function public.create_duel(uuid, uuid, integer) from public, anon;
revoke all on function public.respond_duel(uuid, boolean)     from public, anon;
revoke all on function public.vote_duel(uuid, uuid)           from public, anon;
revoke all on function public.settle_duel(uuid)               from public, anon;
grant execute on function public.create_duel(uuid, uuid, integer) to authenticated;
grant execute on function public.respond_duel(uuid, boolean)      to authenticated;
grant execute on function public.vote_duel(uuid, uuid)            to authenticated;
grant execute on function public.settle_duel(uuid)                to authenticated;

alter table public.duels replica identity full;
alter publication supabase_realtime add table public.duels;
alter publication supabase_realtime add table public.duel_votes;
