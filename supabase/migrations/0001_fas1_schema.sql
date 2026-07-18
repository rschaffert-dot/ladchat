-- ============================================================
-- Ladchat Fas 1: schema, RLS, hjälpfunktioner, realtime
-- Applicerad på projekt klznaehwfdcbomwmcgwf 2026-07-18.
-- ============================================================

-- ---------- Tabeller ----------

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 80),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.group_invites (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  token      text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index messages_group_created_idx on public.messages (group_id, created_at desc);
create index group_members_user_idx on public.group_members (user_id);

-- ---------- Hjälpfunktioner (security definer, bryter RLS-rekursion) ----------

create or replace function public.is_group_member(gid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;

create or replace function public.shares_group_with(other uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(
    select 1
    from public.group_members a
    join public.group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- ---------- RPC: skapa grupp + gå med via invite (atomiskt) ----------

create or replace function public.create_group(group_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.groups (name, owner_id) values (group_name, auth.uid()) returning id into gid;
  insert into public.group_members (group_id, user_id, role) values (gid, auth.uid(), 'owner');
  return gid;
end;
$$;

create or replace function public.accept_invite(invite_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select group_id into gid from public.group_invites where token = invite_token;
  if gid is null then raise exception 'invalid invite'; end if;
  insert into public.group_members (group_id, user_id, role)
    values (gid, auth.uid(), 'member')
    on conflict (group_id, user_id) do nothing;
  return gid;
end;
$$;

-- ---------- Trigger: spegla nya auth-användare till profiles ----------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, split_part(coalesce(new.email, 'anvandare'), '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- RLS ----------

alter table public.profiles      enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;
alter table public.messages      enable row level security;

create policy "profiles_select" on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_group_with(id));
create policy "profiles_upsert_self" on public.profiles for insert to authenticated
  with check (id = auth.uid());
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "groups_select_member" on public.groups for select to authenticated
  using (public.is_group_member(id));
create policy "groups_update_owner" on public.groups for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "groups_delete_owner" on public.groups for delete to authenticated
  using (owner_id = auth.uid());

create policy "members_select" on public.group_members for select to authenticated
  using (public.is_group_member(group_id));
create policy "members_leave_self" on public.group_members for delete to authenticated
  using (user_id = auth.uid());

create policy "invites_select_member" on public.group_invites for select to authenticated
  using (public.is_group_member(group_id));
create policy "invites_insert_member" on public.group_invites for insert to authenticated
  with check (public.is_group_member(group_id) and created_by = auth.uid());

create policy "messages_select_member" on public.messages for select to authenticated
  using (public.is_group_member(group_id));
create policy "messages_insert_member" on public.messages for insert to authenticated
  with check (public.is_group_member(group_id) and user_id = auth.uid());

-- ---------- Grants för RPC ----------

revoke all on function public.create_group(text)   from public, anon;
revoke all on function public.accept_invite(text)  from public, anon;
grant execute on function public.create_group(text)  to authenticated;
grant execute on function public.accept_invite(text) to authenticated;

-- ---------- Realtime på messages ----------

alter publication supabase_realtime add table public.messages;
