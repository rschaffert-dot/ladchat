-- ============================================================
-- Aktivera chattar: när en grupp varit tyst i 48h startas en
-- slumpad "aktiveringsaktivitet" som väcker liv i chatten och
-- delar ut poäng. Aktiviteterna är datadrivna (admin lägger till
-- flera) och all poängsättning körs server-side (security definer),
-- klienten litar aldrig på sig själv.
--
-- Inbyggda typer (kind):
--   thumb_order  – "Tummen på bordet": alla skickar en tumme upp.
--                  Först in får flest poäng (N = antal i chatten),
--                  sist får 1p.
--   longest_fart – "Längsta prutten": ladda upp ljud/video på en
--                  prutt. Längst inspelning vinner och får poäng
--                  motsvarande längden i sekunder.
-- ============================================================

-- ---------- Tabeller ----------

-- Admin-hanterade mallar. Flera aktiviteter kan finnas; en slumpas fram.
create table public.activation_activities (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('thumb_order', 'longest_fart')),
  name        text not null check (char_length(name) between 1 and 120),
  description text,
  is_active   boolean not null default true,
  window_hours integer not null default 24 check (window_hours between 1 and 168),
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- En pågående/avslutad aktivering i en specifik grupp. kind/name snapshottas
-- så resultatet står sig även om mallen ändras/raderas efteråt.
create table public.group_activations (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  activity_id  uuid references public.activation_activities(id) on delete set null,
  kind         text not null check (kind in ('thumb_order', 'longest_fart')),
  name         text not null,
  status       text not null default 'active' check (status in ('active', 'completed')),
  started_at   timestamptz not null default now(),
  deadline_at  timestamptz not null,
  completed_at timestamptz
);

-- Bara en aktiv aktivering åt gången per grupp.
create unique index group_activations_one_active_idx
  on public.group_activations (group_id) where (status = 'active');
create index group_activations_group_idx on public.group_activations (group_id, started_at desc);

create table public.activation_participations (
  id             uuid primary key default gen_random_uuid(),
  activation_id  uuid not null references public.group_activations(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  media_path     text,
  duration_ms    integer check (duration_ms is null or duration_ms >= 0),
  rank           integer,
  points_awarded integer not null default 0,
  submitted_at   timestamptz not null default now(),
  unique (activation_id, user_id)
);

-- ---------- Intern logik: starta / avsluta ----------

-- Startar en aktivering i en grupp om det inte redan finns en aktiv och det
-- finns minst en aktiv mall. Postar ett systemmeddelande i chatten.
create or replace function public.start_group_activation(gid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  act   public.activation_activities%rowtype;
  owner uuid;
  aid   uuid;
  intro text;
begin
  -- Låser gruppens rad så två parallella anrop inte kan skapa dubbla aktiveringar.
  select owner_id into owner from public.groups where id = gid for update;
  if owner is null then return null; end if;

  if exists (select 1 from public.group_activations
             where group_id = gid and status = 'active') then
    return null;
  end if;

  select * into act from public.activation_activities
    where is_active order by random() limit 1;
  if act.id is null then return null; end if;

  insert into public.group_activations (group_id, activity_id, kind, name, deadline_at)
    values (gid, act.id, act.kind, act.name, now() + make_interval(hours => act.window_hours))
    returning id into aid;

  intro := case act.kind
    when 'thumb_order' then '💤 Chatten har somnat! ' || act.name ||
      ' — alla skickar en 👍 nu. Först in får flest poäng!'
    when 'longest_fart' then '💤 Chatten har somnat! ' || act.name ||
      ' — ladda upp en prutt 💨. Längst inspelning vinner!'
    else '💤 Dags att väcka chatten: ' || act.name || '!'
  end;

  insert into public.messages (group_id, user_id, content, kind, metadata)
    values (gid, owner, intro, 'system',
      jsonb_build_object('type', 'activation_started', 'activation_id', aid, 'activity_kind', act.kind));

  return aid;
end;
$$;

-- Avslutar en aktivering: rangordnar deltagarna, delar ut poäng och postar
-- ett resultat-systemmeddelande. Idempotent (gör inget om redan avslutad).
create or replace function public.complete_group_activation(aid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a         public.group_activations%rowtype;
  owner     uuid;
  n_members integer;
  winner    text;
  summary   text;
  r         record;
begin
  select * into a from public.group_activations where id = aid for update;
  if a.id is null or a.status <> 'active' then return; end if;

  select owner_id into owner from public.groups where id = a.group_id;
  select count(*) into n_members from public.group_members where group_id = a.group_id;

  if a.kind = 'thumb_order' then
    -- Först in får flest: N, N-1, ... ned till minst 1p. N = antal i chatten.
    for r in
      select p.id, p.user_id,
             greatest(n_members - (row_number() over (order by p.submitted_at asc) - 1), 1) as pts
      from public.activation_participations p
      where p.activation_id = aid
    loop
      update public.activation_participations
        set points_awarded = r.pts,
            rank = (select count(*) from public.activation_participations p2
                    where p2.activation_id = aid and p2.submitted_at <= (
                      select submitted_at from public.activation_participations where id = r.id))
        where id = r.id;
      update public.group_members set points = points + r.pts
        where group_id = a.group_id and user_id = r.user_id;
    end loop;

    select display_name into winner from public.profiles p
      join public.activation_participations ap on ap.user_id = p.id
      where ap.activation_id = aid order by ap.submitted_at asc limit 1;

  elsif a.kind = 'longest_fart' then
    -- Bara vinnaren (längst inspelning) får poäng = längden i sekunder.
    for r in
      select p.id, p.user_id, p.duration_ms,
             row_number() over (order by p.duration_ms desc nulls last, p.submitted_at asc) as rn
      from public.activation_participations p
      where p.activation_id = aid
    loop
      update public.activation_participations
        set rank = r.rn,
            points_awarded = case when r.rn = 1
              then greatest(round(coalesce(r.duration_ms, 0) / 1000.0)::integer, 1) else 0 end
        where id = r.id;
      if r.rn = 1 then
        update public.group_members
          set points = points + greatest(round(coalesce(r.duration_ms, 0) / 1000.0)::integer, 1)
          where group_id = a.group_id and user_id = r.user_id;
      end if;
    end loop;

    select display_name into winner from public.profiles p
      join public.activation_participations ap on ap.user_id = p.id
      where ap.activation_id = aid order by ap.duration_ms desc nulls last, ap.submitted_at asc limit 1;
  end if;

  if winner is null then
    summary := '😴 ' || a.name || ' avslutades — ingen deltog den här gången.';
  else
    summary := '🏁 ' || a.name || ' är avgjord! Vinnare: ' || winner || '. Kolla topplistan!';
  end if;

  update public.group_activations
    set status = 'completed', completed_at = now() where id = aid;

  insert into public.messages (group_id, user_id, content, kind, metadata)
    values (a.group_id, owner, summary, 'system',
      jsonb_build_object('type', 'activation_completed', 'activation_id', aid));
end;
$$;

-- ---------- Cron-ingång: kör periodiskt ----------

-- Avslutar förfallna aktiveringar och startar nya i grupper som varit tysta
-- i 48h. Anropas av pg_cron (se 0012). SECURITY DEFINER — ägaren (postgres)
-- kringgår RLS precis som övriga systemtriggrar.
create or replace function public.process_inactive_groups()
returns void language plpgsql security definer set search_path = public as $$
declare g record;
begin
  -- 1) Avsluta det som passerat sin deadline.
  for g in select id from public.group_activations where status = 'active' and deadline_at <= now()
  loop
    perform public.complete_group_activation(g.id);
  end loop;

  -- 2) Starta nya i grupper som haft aktivitet men tystnat i minst 48h och
  --    inte redan har en pågående aktivering.
  for g in
    select grp.id
    from public.groups grp
    join lateral (
      select max(created_at) as last_at from public.messages m where m.group_id = grp.id
    ) lm on true
    where lm.last_at is not null
      and lm.last_at <= now() - interval '48 hours'
      and not exists (
        select 1 from public.group_activations ga
        where ga.group_id = grp.id and ga.status = 'active'
      )
  loop
    perform public.start_group_activation(g.id);
  end loop;
end;
$$;

-- ---------- Deltagar-RPC ----------

-- En medlem deltar. thumb_order struntar i media; longest_fart kräver
-- media_path + duration_ms. Ordningen (submitted_at) bevaras vid omregistrering.
create or replace function public.submit_activation(
  aid uuid, media_path text default null, duration_ms integer default null
) returns void language plpgsql security definer set search_path = public as $$
declare a public.group_activations%rowtype;
begin
  select * into a from public.group_activations where id = aid;
  if a.id is null then raise exception 'activation not found'; end if;
  if not public.is_group_member(a.group_id) then raise exception 'not a member'; end if;
  if a.status <> 'active' or a.deadline_at <= now() then raise exception 'activation closed'; end if;

  if a.kind = 'longest_fart' then
    if media_path is null or duration_ms is null or duration_ms <= 0 then
      raise exception 'fart requires media and duration';
    end if;
    insert into public.activation_participations (activation_id, user_id, media_path, duration_ms)
      values (aid, auth.uid(), media_path, duration_ms)
      on conflict (activation_id, user_id)
      do update set media_path = excluded.media_path, duration_ms = excluded.duration_ms;
  else
    insert into public.activation_participations (activation_id, user_id)
      values (aid, auth.uid())
      on conflict (activation_id, user_id) do nothing;
  end if;
end;
$$;

-- ---------- Admin-hjälp (test / manuell körning) ----------

create or replace function public.admin_start_activation(gid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'admin only'; end if;
  return public.start_group_activation(gid);
end;
$$;

create or replace function public.admin_complete_activation(aid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'admin only'; end if;
  perform public.complete_group_activation(aid);
end;
$$;

-- ---------- Grants ----------

revoke all on function public.start_group_activation(uuid)          from public, anon, authenticated;
revoke all on function public.complete_group_activation(uuid)       from public, anon, authenticated;
revoke all on function public.process_inactive_groups()             from public, anon, authenticated;
revoke all on function public.submit_activation(uuid, text, integer) from public, anon;
revoke all on function public.admin_start_activation(uuid)          from public, anon;
revoke all on function public.admin_complete_activation(uuid)       from public, anon;

grant execute on function public.submit_activation(uuid, text, integer) to authenticated;
grant execute on function public.admin_start_activation(uuid)          to authenticated;
grant execute on function public.admin_complete_activation(uuid)       to authenticated;

-- ---------- RLS ----------

alter table public.activation_activities     enable row level security;
alter table public.group_activations         enable row level security;
alter table public.activation_participations enable row level security;

-- Mallar: alla inloggade kan läsa, bara admin skriver.
create policy "activation_activities_select_all" on public.activation_activities
  for select to authenticated using (true);
create policy "activation_activities_insert_admin" on public.activation_activities
  for insert to authenticated with check (public.is_platform_admin() and created_by = auth.uid());
create policy "activation_activities_update_admin" on public.activation_activities
  for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "activation_activities_delete_admin" on public.activation_activities
  for delete to authenticated using (public.is_platform_admin());

-- Aktiveringar + deltaganden: gruppens medlemmar (eller admin) kan läsa.
-- Skrivning sker bara via RPC:erna ovan.
create policy "group_activations_select_member" on public.group_activations
  for select to authenticated
  using (public.is_group_member(group_id) or public.is_platform_admin());

create policy "activation_participations_select_member" on public.activation_participations
  for select to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.group_activations ga
      where ga.id = activation_id and public.is_group_member(ga.group_id)
    )
  );

-- ---------- Lagring: prutt-media ----------
-- Privat bucket, sökväg "{activation_id}/{group_id}/{user_id}-ts.ext".
-- Gruppmedlemmar kan ladda upp och lyssna på lagets bidrag.

insert into storage.buckets (id, name, public)
values ('activation-media', 'activation-media', false)
on conflict (id) do nothing;

create policy "activation_media_insert_member" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'activation-media'
    and public.is_group_member((split_part(name, '/', 2))::uuid)
  );

create policy "activation_media_select_member" on storage.objects for select to authenticated
  using (
    bucket_id = 'activation-media'
    and public.is_group_member((split_part(name, '/', 2))::uuid)
  );

-- ---------- Realtime ----------

alter table public.group_activations         replica identity full;
alter table public.activation_participations replica identity full;

alter publication supabase_realtime add table public.group_activations;
alter publication supabase_realtime add table public.activation_participations;
