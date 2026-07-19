-- ============================================================
-- Öl-mode: gruppen väljer ett glas, varje meddelande = 1 cl.
-- När glaset blir fullt får alla medlemmar poäng och glaset nollställs.
-- All spellogik körs server-side (trigger + security definer-RPC),
-- klienten litar aldrig på sig själv för fyllnadsgrad eller poäng.
-- ============================================================

alter table public.groups
  add column beer_glass_size text
    check (beer_glass_size in ('galopp', 'storstark', 'slaktarbagare')),
  add column beer_fill_cl integer not null default 0;

alter table public.group_members
  add column points integer not null default 0;

-- ---------- Glasstorlekar: cl-kapacitet och poäng vid fullt glas ----------

create or replace function public.beer_glass_capacity(size text)
returns integer language sql immutable as $$
  select case size
    when 'galopp' then 33
    when 'storstark' then 40
    when 'slaktarbagare' then 100
  end;
$$;

create or replace function public.beer_glass_points(size text)
returns integer language sql immutable as $$
  select case size
    when 'galopp' then 33
    when 'storstark' then 50
    when 'slaktarbagare' then 150
  end;
$$;

-- ---------- Trigger: fyll glaset 1 cl per meddelande, dela ut poäng vid fullt ----------

create or replace function public.handle_message_beer_fill()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  gsize   text;
  cap     integer;
  pts     integer;
  filled  integer;
begin
  -- Låser gruppens rad så att parallella meddelanden i samma grupp inte
  -- kan kapplöpa om fyllnadsgraden eller ge poäng flera gånger för samma glas.
  select beer_glass_size into gsize
    from public.groups where id = new.group_id for update;

  if gsize is null then
    return new;
  end if;

  cap := public.beer_glass_capacity(gsize);
  pts := public.beer_glass_points(gsize);

  update public.groups
    set beer_fill_cl = beer_fill_cl + 1
    where id = new.group_id
    returning beer_fill_cl into filled;

  if filled >= cap then
    update public.group_members
      set points = points + pts
      where group_id = new.group_id;

    update public.groups
      set beer_fill_cl = 0
      where id = new.group_id;
  end if;

  return new;
end;
$$;

create trigger on_message_beer_fill
  after insert on public.messages
  for each row execute function public.handle_message_beer_fill();

-- ---------- RPC: medlem väljer (eller stänger av) glas för gruppen ----------

create or replace function public.set_beer_glass(gid uuid, size text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;
  if size is not null and size not in ('galopp', 'storstark', 'slaktarbagare') then
    raise exception 'invalid glass size';
  end if;

  update public.groups
    set beer_glass_size = size, beer_fill_cl = 0
    where id = gid;
end;
$$;

-- ---------- Behörigheter ----------

revoke all on function public.handle_message_beer_fill() from public, anon, authenticated;
revoke all on function public.beer_glass_capacity(text)  from public, anon;
revoke all on function public.beer_glass_points(text)    from public, anon;
revoke all on function public.set_beer_glass(uuid, text) from public, anon;

grant execute on function public.beer_glass_capacity(text) to authenticated;
grant execute on function public.beer_glass_points(text)   to authenticated;
grant execute on function public.set_beer_glass(uuid, text) to authenticated;

-- ---------- Realtime: dela fyllnadsgrad och poäng live ----------

-- Utan detta skickar Postgres bara primärnyckeln i "old record" vid UPDATE,
-- och klienten behöver hela gamla raden för att avgöra om glaset just blev fullt.
alter table public.groups replica identity full;

alter publication supabase_realtime add table public.groups;
alter publication supabase_realtime add table public.group_members;
