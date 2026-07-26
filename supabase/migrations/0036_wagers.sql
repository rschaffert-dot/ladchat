-- ============================================================
-- Gissningar (vad): "när vaknar Kalle?" — någon skapar en gissning,
-- alla i gruppen lämnar sin gissning (klockslag eller siffra),
-- skaparen anger facit och vinnaren koras automatiskt server-side.
--
-- Värderepresentation: allt lagras som numeric i "value".
--   kind = 'time'   → minuter sedan midnatt (0–1439), label "HH:MM".
--   kind = 'number' → talet självt, label = talet som text.
-- Närmast vinner; för klockslag räknas avståndet runt midnatt
-- (23:50 vs 00:10 är 20 minuter, inte 23 timmar). Delad vinst möjlig.
-- ============================================================

alter table public.messages drop constraint messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('user', 'system', 'image', 'audio', 'poll', 'wager'));

create table public.wagers (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  question     text not null check (char_length(question) between 1 and 200),
  kind         text not null default 'time' check (kind in ('time', 'number')),
  created_by   uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  settled_at   timestamptz,
  result_value numeric,
  result_label text,
  winner_ids   uuid[] not null default '{}'
);

-- group_id dubbleras för realtime-filtrering per grupp (samma mönster som poll_votes).
create table public.wager_guesses (
  wager_id   uuid not null references public.wagers(id) on delete cascade,
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  value      numeric not null,
  label      text not null check (char_length(label) between 1 and 50),
  created_at timestamptz not null default now(),
  primary key (wager_id, user_id)
);

alter table public.wagers        enable row level security;
alter table public.wager_guesses enable row level security;

create policy "wagers_select_member" on public.wagers for select to authenticated
  using (public.is_group_member(group_id));
create policy "wager_guesses_select_member" on public.wager_guesses for select to authenticated
  using (public.is_group_member(group_id));

create or replace function public.create_wager(gid uuid, question text, wkind text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  wid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;
  if wkind not in ('time', 'number') then raise exception 'invalid wager kind'; end if;

  insert into public.wagers (group_id, question, kind, created_by)
    values (gid, question, wkind, auth.uid())
    returning id into wid;

  insert into public.messages (group_id, user_id, content, kind, metadata)
    values (gid, auth.uid(), '🎯 ' || question, 'wager', jsonb_build_object('wager_id', wid));

  return wid;
end;
$$;

create or replace function public.guess_wager(wid uuid, guess_value numeric, guess_label text)
returns void language plpgsql security definer set search_path = public as $$
declare
  w public.wagers%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into w from public.wagers where id = wid;
  if w.id is null then raise exception 'wager not found'; end if;
  if not public.is_group_member(w.group_id) then raise exception 'not a member'; end if;
  if w.settled_at is not null then raise exception 'wager already settled'; end if;
  if w.kind = 'time' and (guess_value < 0 or guess_value > 1439) then
    raise exception 'time guesses are minutes since midnight (0-1439)';
  end if;

  insert into public.wager_guesses (wager_id, group_id, user_id, value, label)
    values (wid, w.group_id, auth.uid(), guess_value, guess_label)
    on conflict (wager_id, user_id)
      do update set value = excluded.value, label = excluded.label, created_at = now();
end;
$$;

create or replace function public.settle_wager(wid uuid, actual_value numeric, actual_label text)
returns void language plpgsql security definer set search_path = public as $$
declare
  w        public.wagers%rowtype;
  best     numeric;
  winners  uuid[];
  names    text;
  winlabel text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into w from public.wagers where id = wid;
  if w.id is null then raise exception 'wager not found'; end if;
  if w.created_by <> auth.uid() then raise exception 'only the creator can settle'; end if;
  if w.settled_at is not null then raise exception 'wager already settled'; end if;
  if w.kind = 'time' and (actual_value < 0 or actual_value > 1439) then
    raise exception 'time results are minutes since midnight (0-1439)';
  end if;
  if not exists (select 1 from public.wager_guesses where wager_id = wid) then
    raise exception 'no guesses yet';
  end if;

  -- Minsta avstånd; klockslag mäts runt midnatt.
  select min(case when w.kind = 'time'
                  then least(abs(value - actual_value), 1440 - abs(value - actual_value))
                  else abs(value - actual_value) end)
    into best
    from public.wager_guesses where wager_id = wid;

  select array_agg(user_id)
    into winners
    from public.wager_guesses
    where wager_id = wid
      and (case when w.kind = 'time'
                then least(abs(value - actual_value), 1440 - abs(value - actual_value))
                else abs(value - actual_value) end) = best;

  update public.wagers
    set settled_at = now(), result_value = actual_value,
        result_label = actual_label, winner_ids = winners
    where id = wid;

  -- Vinstpoäng via den delade motorn.
  perform public.award_points(w.group_id, u, 15, 'wager_win', jsonb_build_object('wager_id', wid))
    from unnest(winners) as u;

  select string_agg(coalesce(p.display_name, p.email, 'Okänd'), ', ')
    into names
    from unnest(winners) as u
    join public.profiles p on p.id = u;

  select label into winlabel
    from public.wager_guesses
    where wager_id = wid and user_id = winners[1];

  insert into public.messages (group_id, user_id, content, kind, metadata)
    values (
      w.group_id, auth.uid(),
      '🏆 "' || w.question || '" avgjord! Facit: ' || actual_label ||
        '. Närmast: ' || names || ' (' || winlabel || ') — +15 poäng!',
      'system', jsonb_build_object('wager_id', wid)
    );
end;
$$;

revoke all on function public.create_wager(uuid, text, text)       from public, anon;
revoke all on function public.guess_wager(uuid, numeric, text)     from public, anon;
revoke all on function public.settle_wager(uuid, numeric, text)    from public, anon;
grant execute on function public.create_wager(uuid, text, text)    to authenticated;
grant execute on function public.guess_wager(uuid, numeric, text)  to authenticated;
grant execute on function public.settle_wager(uuid, numeric, text) to authenticated;

alter publication supabase_realtime add table public.wagers;
alter publication supabase_realtime add table public.wager_guesses;
