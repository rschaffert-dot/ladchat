-- ============================================================
-- Funktion 9: Trophy-skåp (achievements) och
-- funktion 10: Gemensam energibar + Power Hour (dubbel XP).
-- award_points byggs om: dubblar XP under aktiv Power Hour och delar
-- ut badges automatiskt utifrån reason/poängsumma — fortfarande den
-- enda vägen in för poäng.
-- ============================================================

create table public.achievements (
  code        text primary key,
  name        text not null,
  emoji       text not null,
  description text not null
);

alter table public.achievements enable row level security;
create policy "achievements_select" on public.achievements for select to authenticated using (true);

insert into public.achievements (code, name, emoji, description) values
  ('first_reaction', 'Första respekten', '💪', 'Fick sin första reaktion av en grabb'),
  ('points_100',     'Hundring',         '💯', 'Nådde 100 poäng i en grupp'),
  ('points_500',     'Storspelare',      '🏆', 'Nådde 500 poäng i en grupp'),
  ('level_legend',   'Legend',           '👑', 'Nådde 700 poäng — högsta rangen'),
  ('streak_7',       'Veckostreak',      '🔥', 'Checkade in 7 dagar i rad'),
  ('duel_winner',    'Duellvinnare',     '⚔️', 'Vann en duell inför gruppen'),
  ('quest_master',   'Questmästare',     '🎯', 'Klarade dagens utmaning');

create table public.user_achievements (
  user_id   uuid not null references auth.users(id) on delete cascade,
  code      text not null references public.achievements(code) on delete cascade,
  group_id  uuid references public.groups(id) on delete set null,
  earned_at timestamptz not null default now(),
  primary key (user_id, code)
);

alter table public.user_achievements enable row level security;
create policy "user_achievements_select" on public.user_achievements for select to authenticated
  using (user_id = auth.uid() or public.shares_group_with(user_id));

create or replace function public.grant_achievement(uid uuid, badge text, gid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  inserted boolean;
  a public.achievements%rowtype;
begin
  insert into public.user_achievements (user_id, code, group_id)
    values (uid, badge, gid)
    on conflict (user_id, code) do nothing;
  inserted := found;
  if inserted then
    select * into a from public.achievements where code = badge;
    insert into public.notifications (user_id, group_id, kind, content)
      values (uid, gid, 'achievement', a.emoji || ' Ny trofé: ' || a.name || '!');
  end if;
end;
$$;

revoke all on function public.grant_achievement(uuid, text, uuid) from public, anon, authenticated;

-- ---------- Energibar + Power Hour ----------

alter table public.groups
  add column energy integer not null default 0,
  add column energy_updated_at timestamptz not null default now();

create table public.power_hours (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid not null references public.groups(id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at   timestamptz not null
);

create index power_hours_group_idx on public.power_hours (group_id, ends_at desc);

alter table public.power_hours enable row level security;
create policy "power_hours_select_member" on public.power_hours for select to authenticated
  using (public.is_group_member(group_id));

create or replace function public.power_hour_active(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.power_hours
    where group_id = gid and now() between starts_at and ends_at
  );
$$;

revoke all on function public.power_hour_active(uuid) from public, anon;
grant execute on function public.power_hour_active(uuid) to authenticated;

-- Energi: +4 per meddelande, förfaller med 1 per 2:e minut av tystnad.
-- Vid hög energi kan en slumpad Power Hour (dubbel XP i 60 min) starta.
create or replace function public.handle_message_energy()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cur_energy  integer;
  cur_updated timestamptz;
  decayed     integer;
  new_energy  integer;
begin
  select energy, energy_updated_at into cur_energy, cur_updated
    from public.groups where id = new.group_id for update;

  decayed := greatest(0, cur_energy - floor(extract(epoch from (now() - cur_updated)) / 120)::integer);
  new_energy := least(100, decayed + 4);

  update public.groups
    set energy = new_energy, energy_updated_at = now()
    where id = new.group_id;

  if new.kind = 'user'
     and new_energy >= 80
     and random() < 0.05
     and not exists (select 1 from public.power_hours where group_id = new.group_id and ends_at > now())
     and not exists (select 1 from public.power_hours where group_id = new.group_id and starts_at > now() - interval '3 hours')
  then
    insert into public.power_hours (group_id, ends_at) values (new.group_id, now() + interval '1 hour');
    insert into public.messages (group_id, user_id, content, kind, metadata)
      values (new.group_id, new.user_id, '⚡ POWER HOUR! Dubbel XP i 60 minuter — kör!', 'system',
              jsonb_build_object('power_hour', true));
  end if;

  return new;
end;
$$;

create trigger on_message_energy
  after insert on public.messages
  for each row execute function public.handle_message_energy();

revoke all on function public.handle_message_energy() from public, anon, authenticated;

-- ---------- award_points v2: Power Hour-dubbling + auto-badges ----------

create or replace function public.award_points(
  gid uuid, uid uuid, amount integer, reason text, meta jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  amt   integer := amount;
  total integer;
begin
  -- Dubbel XP under Power Hour — bara positiva belopp, och inte duellens
  -- pott/insatser (de är förflyttade poäng, inte intjänade).
  if amount > 0 and reason not like 'duel_%' and public.power_hour_active(gid) then
    amt := amount * 2;
    meta := meta || jsonb_build_object('power_hour', true);
  end if;

  insert into public.point_events (group_id, user_id, amount, reason, metadata)
    values (gid, uid, amt, reason, meta);

  update public.group_members
    set points = points + amt
    where group_id = gid and user_id = uid
    returning points into total;

  -- Automatiska troféer.
  if reason like 'reaction:%' then
    perform public.grant_achievement(uid, 'first_reaction', gid);
  end if;
  if reason = 'duel_win' then
    perform public.grant_achievement(uid, 'duel_winner', gid);
  end if;
  if reason = 'daily_quest' then
    perform public.grant_achievement(uid, 'quest_master', gid);
  end if;
  if reason = 'streak_checkin' and coalesce((meta->>'streak')::integer, 0) >= 7 then
    perform public.grant_achievement(uid, 'streak_7', gid);
  end if;
  if total >= 100 then perform public.grant_achievement(uid, 'points_100', gid); end if;
  if total >= 500 then perform public.grant_achievement(uid, 'points_500', gid); end if;
  if total >= 700 then perform public.grant_achievement(uid, 'level_legend', gid); end if;
end;
$$;

revoke all on function public.award_points(uuid, uuid, integer, text, jsonb) from public, anon, authenticated;

-- ---------- Veckotopplista (funktion 6) ----------

-- Summerar poänghändelser sedan veckostart (måndag). Den permanenta
-- poängsumman nollställs aldrig — veckan räknas ur loggen.
create or replace function public.weekly_leaderboard(gid uuid)
returns table (user_id uuid, weekly_points bigint)
language sql stable security definer set search_path = public as $$
  select pe.user_id, sum(pe.amount)::bigint as weekly_points
  from public.point_events pe
  where pe.group_id = gid
    and public.is_group_member(gid)
    and pe.created_at >= date_trunc('week', now())
    and pe.amount > 0
  group by pe.user_id
  order by weekly_points desc;
$$;

-- Förra veckans vinnare = Grabb of the Week.
create or replace function public.grabb_of_the_week(gid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select pe.user_id
  from public.point_events pe
  where pe.group_id = gid
    and public.is_group_member(gid)
    and pe.created_at >= date_trunc('week', now()) - interval '7 days'
    and pe.created_at <  date_trunc('week', now())
    and pe.amount > 0
  group by pe.user_id
  order by sum(pe.amount) desc
  limit 1;
$$;

revoke all on function public.weekly_leaderboard(uuid) from public, anon;
revoke all on function public.grabb_of_the_week(uuid)  from public, anon;
grant execute on function public.weekly_leaderboard(uuid) to authenticated;
grant execute on function public.grabb_of_the_week(uuid)  to authenticated;

alter publication supabase_realtime add table public.power_hours;
alter publication supabase_realtime add table public.user_achievements;
