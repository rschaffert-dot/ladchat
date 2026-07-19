-- ============================================================
-- Funktion 5: Grabbstreak (daglig incheckning) och
-- funktion 8: Dagens utmaning (roterande daglig quest).
-- Poäng delas alltid ut via award_points (motorn i 0011).
-- ============================================================

create table public.streaks (
  group_id       uuid not null references public.groups(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  last_checkin   date,
  primary key (group_id, user_id)
);

alter table public.streaks enable row level security;

create policy "streaks_select_member" on public.streaks for select to authenticated
  using (public.is_group_member(group_id));

-- Incheckningen ger 2 poäng + 1 per dag i streaken (max +8 extra).
create or replace function public.checkin_streak(gid uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  row_streak public.streaks%rowtype;
  new_streak integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;

  insert into public.streaks (group_id, user_id)
    values (gid, auth.uid())
    on conflict (group_id, user_id) do nothing;

  select * into row_streak from public.streaks
    where group_id = gid and user_id = auth.uid() for update;

  if row_streak.last_checkin = current_date then
    return row_streak.current_streak;
  end if;

  if row_streak.last_checkin = current_date - 1 then
    new_streak := row_streak.current_streak + 1;
  else
    new_streak := 1;
  end if;

  update public.streaks
    set current_streak = new_streak,
        longest_streak = greatest(longest_streak, new_streak),
        last_checkin   = current_date
    where group_id = gid and user_id = auth.uid();

  perform public.award_points(
    gid, auth.uid(), 2 + least(new_streak, 8), 'streak_checkin',
    jsonb_build_object('streak', new_streak)
  );

  return new_streak;
end;
$$;

revoke all on function public.checkin_streak(uuid) from public, anon;
grant execute on function public.checkin_streak(uuid) to authenticated;

-- ---------- Dagens utmaning ----------

create table public.daily_quests (
  id    integer generated always as identity primary key,
  title text not null,
  bonus integer not null default 10
);

alter table public.daily_quests enable row level security;
create policy "daily_quests_select" on public.daily_quests for select to authenticated using (true);

insert into public.daily_quests (title) values
  ('Skicka en bild på din lunch'),
  ('Ge 3 Respekt-reaktioner till dina grabbar'),
  ('Dra ett riktigt dåligt skämt i chatten'),
  ('Utmana någon på duell'),
  ('Skriv ett helt meddelande på rim'),
  ('Dela dagens bästa story'),
  ('Skicka en gammal pinsam bild på en grabb'),
  ('Hylla en grabb i chatten – utan ironi'),
  ('Checka in din streak före kl 12'),
  ('Använd alla fem reaktionerna under dagen');

-- Roterar deterministiskt per datum så alla ser samma quest.
create or replace function public.todays_quest()
returns table (quest_id integer, title text, bonus integer)
language plpgsql stable security definer set search_path = public as $$
declare
  cnt integer;
  off integer;
begin
  select count(*) into cnt from public.daily_quests;
  if cnt = 0 then return; end if;
  off := (current_date - date '2026-01-01') % cnt;
  return query select q.id, q.title, q.bonus
    from public.daily_quests q order by q.id offset off limit 1;
end;
$$;

revoke all on function public.todays_quest() from public, anon;
grant execute on function public.todays_quest() to authenticated;

create table public.quest_completions (
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  quest_date date not null default current_date,
  quest_id   integer not null references public.daily_quests(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id, quest_date)
);

alter table public.quest_completions enable row level security;

create policy "quest_completions_select_member" on public.quest_completions for select to authenticated
  using (public.is_group_member(group_id));

create or replace function public.complete_daily_quest(gid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  q record;
  inserted boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;

  select * into q from public.todays_quest();
  if q.quest_id is null then raise exception 'no quest today'; end if;

  insert into public.quest_completions (group_id, user_id, quest_date, quest_id)
    values (gid, auth.uid(), current_date, q.quest_id)
    on conflict (group_id, user_id, quest_date) do nothing;
  inserted := found;

  if inserted then
    perform public.award_points(
      gid, auth.uid(), q.bonus, 'daily_quest',
      jsonb_build_object('quest_id', q.quest_id, 'title', q.title)
    );
  end if;
end;
$$;

revoke all on function public.complete_daily_quest(uuid) from public, anon;
grant execute on function public.complete_daily_quest(uuid) to authenticated;
