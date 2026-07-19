-- ============================================================
-- Öl-mode: tidsbegränsad runda. Gruppen väljer även en tidsgräns
-- (15–120 min) utöver glasstorlek. Kortare tid = svårare = bonuspoäng.
-- Hinner glaset inte fyllas i tid nollställs rundan utan belöning.
-- All tidslogik körs server-side (samma motivering som 0004).
-- ============================================================

alter table public.groups
  add column beer_round_started_at timestamptz,
  add column beer_duration_minutes integer;

-- ---------- Bonuspoäng för vald tidsgräns ----------

create or replace function public.beer_duration_bonus(minutes integer)
returns integer language sql immutable as $$
  select case minutes
    when 15 then 25
    when 30 then 12
    when 45 then 8
    when 60 then 5
    when 75 then 4
    when 90 then 3
    when 105 then 2
    when 120 then 1
    else 0
  end;
$$;

-- ---------- Trigger: nollställ utan belöning om tiden gått ut ----------

create or replace function public.handle_message_beer_fill()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  gsize    text;
  gstart   timestamptz;
  gdur     integer;
  cap      integer;
  pts      integer;
  bonus    integer;
  filled   integer;
  deadline timestamptz;
begin
  select beer_glass_size, beer_round_started_at, beer_duration_minutes
    into gsize, gstart, gdur
    from public.groups where id = new.group_id for update;

  if gsize is null then
    return new;
  end if;

  deadline := gstart + make_interval(mins => gdur);

  if gstart is not null and now() > deadline then
    -- Tiden gick ut innan glaset blev fullt: ingen belöning, ny runda startar.
    update public.groups
      set beer_fill_cl = 0, beer_round_started_at = now()
      where id = new.group_id;
    return new;
  end if;

  cap   := public.beer_glass_capacity(gsize);
  pts   := public.beer_glass_points(gsize);
  bonus := public.beer_duration_bonus(gdur);

  update public.groups
    set beer_fill_cl = beer_fill_cl + 1
    where id = new.group_id
    returning beer_fill_cl into filled;

  if filled >= cap then
    update public.group_members
      set points = points + pts + bonus
      where group_id = new.group_id;

    update public.groups
      set beer_fill_cl = 0, beer_round_started_at = now()
      where id = new.group_id;
  end if;

  return new;
end;
$$;

-- ---------- RPC: medlem väljer glas + tidsgräns (eller stänger av) ----------

create or replace function public.set_beer_glass(gid uuid, size text, duration_minutes integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;

  if size is null then
    update public.groups
      set beer_glass_size = null, beer_fill_cl = 0,
          beer_round_started_at = null, beer_duration_minutes = null
      where id = gid;
    return;
  end if;

  if size not in ('galopp', 'storstark', 'slaktarbagare') then
    raise exception 'invalid glass size';
  end if;
  if duration_minutes not in (15, 30, 45, 60, 75, 90, 105, 120) then
    raise exception 'invalid duration';
  end if;

  update public.groups
    set beer_glass_size = size,
        beer_fill_cl = 0,
        beer_round_started_at = now(),
        beer_duration_minutes = duration_minutes
    where id = gid;
end;
$$;

revoke all on function public.beer_duration_bonus(integer) from public, anon;
grant execute on function public.beer_duration_bonus(integer) to authenticated;

-- set_beer_glass(uuid, text) från 0004 ersätts av 3-parametersversionen ovan.
drop function if exists public.set_beer_glass(uuid, text);
revoke all on function public.set_beer_glass(uuid, text, integer) from public, anon;
grant execute on function public.set_beer_glass(uuid, text, integer) to authenticated;
