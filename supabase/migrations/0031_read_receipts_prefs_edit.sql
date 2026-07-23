-- ============================================================
-- Tre UX-byggstenar i ett:
-- 1) Läskvitton: message_reads håller "senast läst"-tidpunkt per
--    medlem och grupp. Egna meddelanden visar ✓ (skickat) tills ALLA
--    andra medlemmar läst — då blå ✓✓. Skrivs via mark_read().
-- 2) Chattlisteval: nåla/mute/arkivera per medlemskap. Skrivs via
--    set_chat_prefs() (aldrig direkt UPDATE — group_members bär
--    points, som ingen ska kunna skriva själv).
-- 3) Redigera meddelande: edit_message() tillåter ändring av egna
--    textmeddelanden i 15 minuter och stämplar edited_at.
-- ============================================================

-- ---------- 1) Läskvitton ----------

create table if not exists public.message_reads (
  group_id     uuid not null references public.groups(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.message_reads enable row level security;

drop policy if exists "message_reads_select_member" on public.message_reads;
create policy "message_reads_select_member" on public.message_reads
  for select to authenticated using (public.is_group_member(group_id));

create or replace function public.mark_read(gid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;
  insert into public.message_reads (group_id, user_id, last_read_at)
    values (gid, auth.uid(), now())
    on conflict (group_id, user_id) do update set last_read_at = now();
end;
$$;

revoke all on function public.mark_read(uuid) from public, anon;
grant execute on function public.mark_read(uuid) to authenticated;

alter table public.message_reads replica identity full;
alter publication supabase_realtime add table public.message_reads;

-- ---------- 2) Chattlisteval ----------

alter table public.group_members add column if not exists pinned_at timestamptz;
alter table public.group_members add column if not exists muted boolean not null default false;
alter table public.group_members add column if not exists archived boolean not null default false;

create or replace function public.set_chat_prefs(
  gid uuid, pin boolean default null, mute boolean default null, arch boolean default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.group_members set
    pinned_at = case when pin is null then pinned_at when pin then now() else null end,
    muted     = coalesce(mute, muted),
    archived  = coalesce(arch, archived)
    where group_id = gid and user_id = auth.uid();
  if not found then raise exception 'not a member'; end if;
end;
$$;

revoke all on function public.set_chat_prefs(uuid, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_chat_prefs(uuid, boolean, boolean, boolean) to authenticated;

-- ---------- 3) Redigera meddelande ----------

alter table public.messages add column if not exists edited_at timestamptz;

create or replace function public.edit_message(mid uuid, new_content text)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.messages%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if new_content is null or char_length(btrim(new_content)) < 1
     or char_length(new_content) > 2000 then
    raise exception 'invalid content';
  end if;

  select * into m from public.messages where id = mid for update;
  if m.id is null then raise exception 'message not found'; end if;
  if m.user_id <> auth.uid() then raise exception 'only own messages'; end if;
  if m.kind <> 'user' then raise exception 'only text messages'; end if;
  if m.created_at < now() - interval '15 minutes' then
    raise exception 'edit window expired';
  end if;

  update public.messages
    set content = btrim(new_content), edited_at = now()
    where id = mid;
end;
$$;

revoke all on function public.edit_message(uuid, text) from public, anon;
grant execute on function public.edit_message(uuid, text) to authenticated;
