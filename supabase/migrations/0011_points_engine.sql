-- ============================================================
-- Delad poäng-/XP-motor. Alla nya spelfunktioner (reaktioner, dueller,
-- streaks, utmaningar...) poängsätts genom award_points(), som är den enda
-- vägen in: den skriver en logg-rad (point_events) och uppdaterar den
-- redan befintliga group_members.points atomiskt. Klienter kan aldrig
-- anropa award_points direkt — bara andra security definer-funktioner.
-- ============================================================

create table public.point_events (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  amount     integer not null,
  reason     text not null,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index point_events_group_created_idx on public.point_events (group_id, created_at desc);
create index point_events_user_idx on public.point_events (user_id);

alter table public.point_events enable row level security;

create policy "point_events_select_member" on public.point_events for select to authenticated
  using (public.is_group_member(group_id));

-- ---------- Motorn ----------

create or replace function public.award_points(
  gid uuid, uid uuid, amount integer, reason text, meta jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.point_events (group_id, user_id, amount, reason, metadata)
    values (gid, uid, amount, reason, meta);

  update public.group_members
    set points = points + amount
    where group_id = gid and user_id = uid;
end;
$$;

revoke all on function public.award_points(uuid, uuid, integer, text, jsonb) from public, anon, authenticated;

-- ---------- Level & titel: rena funktioner av poängsumman, ingen extra kolumn ----------

create or replace function public.level_for_points(pts integer)
returns integer language sql immutable set search_path = public as $$
  select case
    when pts >= 700 then 5
    when pts >= 350 then 4
    when pts >= 150 then 3
    when pts >= 50  then 2
    else 1
  end;
$$;

create or replace function public.title_for_level(lvl integer)
returns text language sql immutable set search_path = public as $$
  select case lvl
    when 1 then 'Ynkrygg'
    when 2 then 'Lärling'
    when 3 then 'Grabb'
    when 4 then 'Alfa'
    when 5 then 'Legend'
    else 'Ynkrygg'
  end;
$$;

grant execute on function public.level_for_points(integer) to authenticated;
grant execute on function public.title_for_level(integer) to authenticated;

-- ---------- Realtime: poänghändelser (för framtida live-topplistor) ----------

alter publication supabase_realtime add table public.point_events;
