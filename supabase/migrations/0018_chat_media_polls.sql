-- ============================================================
-- Messenger-liknande chatt: bild-/kamera-uppladdning, röstmemon
-- och omröstningar. Media lagras i privat bucket "chat-media" med
-- sökvägen {group_id}/{user_id}/{filnamn} och läses via signerade
-- URL:er. Meddelanden får nya kinds: image, audio, poll — innehållet
-- är alltid en läsbar fallback-text ("📷 Bild") så äldre klienter
-- och notiser fortsätter fungera.
-- ============================================================

alter table public.messages drop constraint messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('user', 'system', 'image', 'audio', 'poll'));

-- ---------- Storage: chat-media ----------

insert into storage.buckets (id, name, public) values ('chat-media', 'chat-media', false);

create policy "chat_media_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and public.is_group_member(split_part(name, '/', 1)::uuid)
    and split_part(name, '/', 2)::uuid = auth.uid()
  );

create policy "chat_media_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-media'
    and public.is_group_member(split_part(name, '/', 1)::uuid)
  );

-- ---------- Omröstningar ----------

create table public.polls (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  question   text not null check (char_length(question) between 1 and 200),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.poll_options (
  id      uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  label   text not null check (char_length(label) between 1 and 100),
  idx     integer not null
);

-- group_id dubbleras för realtime-filtrering per grupp (samma mönster som duel_votes).
create table public.poll_votes (
  poll_id    uuid not null references public.polls(id) on delete cascade,
  group_id   uuid not null references public.groups(id) on delete cascade,
  option_id  uuid not null references public.poll_options(id) on delete cascade,
  voter_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, voter_id)
);

alter table public.polls        enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes   enable row level security;

create policy "polls_select_member" on public.polls for select to authenticated
  using (public.is_group_member(group_id));
create policy "poll_options_select_member" on public.poll_options for select to authenticated
  using (exists (select 1 from public.polls p where p.id = poll_id and public.is_group_member(p.group_id)));
create policy "poll_votes_select_member" on public.poll_votes for select to authenticated
  using (public.is_group_member(group_id));

create or replace function public.create_poll(gid uuid, question text, options text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
  i   integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;
  if options is null or array_length(options, 1) < 2 or array_length(options, 1) > 6 then
    raise exception 'polls need 2-6 options';
  end if;

  insert into public.polls (group_id, question, created_by)
    values (gid, question, auth.uid())
    returning id into pid;

  for i in 1 .. array_length(options, 1) loop
    insert into public.poll_options (poll_id, label, idx) values (pid, options[i], i);
  end loop;

  insert into public.messages (group_id, user_id, content, kind, metadata)
    values (gid, auth.uid(), '📊 ' || question, 'poll', jsonb_build_object('poll_id', pid));

  return pid;
end;
$$;

create or replace function public.vote_poll(pid uuid, oid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.polls%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into p from public.polls where id = pid;
  if p.id is null then raise exception 'poll not found'; end if;
  if not public.is_group_member(p.group_id) then raise exception 'not a member'; end if;
  if not exists (select 1 from public.poll_options where id = oid and poll_id = pid) then
    raise exception 'invalid option';
  end if;

  insert into public.poll_votes (poll_id, group_id, option_id, voter_id)
    values (pid, p.group_id, oid, auth.uid())
    on conflict (poll_id, voter_id) do update set option_id = excluded.option_id;
end;
$$;

revoke all on function public.create_poll(uuid, text, text[]) from public, anon;
revoke all on function public.vote_poll(uuid, uuid)           from public, anon;
grant execute on function public.create_poll(uuid, text, text[]) to authenticated;
grant execute on function public.vote_poll(uuid, uuid)           to authenticated;

alter publication supabase_realtime add table public.poll_votes;
