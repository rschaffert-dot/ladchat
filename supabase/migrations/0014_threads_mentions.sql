-- ============================================================
-- Funktion 2: Trådar & svar + @taggning med in-app-notiser.
-- reply_to_id pekar på meddelandet man svarar på. Klienten löser
-- @namn till user-id:n och lägger dem i metadata.mentions; en trigger
-- skapar notiser för taggade användare och för den man svarar på.
-- ============================================================

alter table public.messages
  add column reply_to_id uuid references public.messages(id) on delete set null;

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  group_id   uuid not null references public.groups(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  kind       text not null,
  content    text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, read, created_at desc);

alter table public.notifications enable row level security;

create policy "notifications_select_own" on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy "notifications_update_own" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.handle_message_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  mention_id uuid;
  parent     public.messages%rowtype;
  sender     text;
begin
  if new.kind <> 'user' then return new; end if;

  select coalesce(display_name, email, 'Någon') into sender
    from public.profiles where id = new.user_id;

  if new.metadata ? 'mentions' then
    for mention_id in
      select distinct (jsonb_array_elements_text(new.metadata->'mentions'))::uuid
    loop
      if mention_id <> new.user_id and exists (
        select 1 from public.group_members
        where group_id = new.group_id and user_id = mention_id
      ) then
        insert into public.notifications (user_id, group_id, message_id, kind, content)
        values (mention_id, new.group_id, new.id, 'mention', sender || ' taggade dig');
      end if;
    end loop;
  end if;

  if new.reply_to_id is not null then
    select * into parent from public.messages where id = new.reply_to_id;
    if parent.user_id is not null and parent.user_id <> new.user_id then
      insert into public.notifications (user_id, group_id, message_id, kind, content)
      values (parent.user_id, new.group_id, new.id, 'reply', sender || ' svarade på ditt meddelande');
    end if;
  end if;

  return new;
end;
$$;

create trigger on_message_notifications
  after insert on public.messages
  for each row execute function public.handle_message_notifications();

revoke all on function public.handle_message_notifications() from public, anon, authenticated;

alter publication supabase_realtime add table public.notifications;
