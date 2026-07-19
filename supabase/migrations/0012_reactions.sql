-- ============================================================
-- Funktion 1: Reaktionssystem. Grabbiga reaktioner på meddelanden,
-- poängsätter mottagaren via den delade motorn (award_points).
-- Klienter skriver aldrig direkt till message_reactions — allt går via
-- toggle_reaction() så att poäng alltid följer med symmetriskt.
-- ============================================================

create table public.message_reactions (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.messages(id) on delete cascade,
  group_id    uuid not null references public.groups(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  reaction    text not null check (reaction in ('respekt', 'skal', 'eld', 'get', 'skalle')),
  created_at  timestamptz not null default now(),
  unique (message_id, user_id, reaction)
);

create index message_reactions_message_idx on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

-- Läsning tillåts direkt (för initial laddning + realtime), all skrivning
-- går via toggle_reaction (security definer) — inga insert/delete-policyer.
create policy "reactions_select_member" on public.message_reactions for select to authenticated
  using (public.is_group_member(group_id));

-- ---------- Poäng per reaktionstyp ----------

create or replace function public.reaction_points(reaction text)
returns integer language sql immutable set search_path = public as $$
  select case reaction
    when 'respekt' then 3
    when 'skal'    then 2
    when 'eld'     then 2
    when 'get'     then 5
    when 'skalle'  then 1
    else 0
  end;
$$;

grant execute on function public.reaction_points(text) to authenticated;

-- ---------- RPC: växla en reaktion på/av ----------

create or replace function public.toggle_reaction(mid uuid, reaction_key text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  msg       public.messages%rowtype;
  pts       integer;
  existing  uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if reaction_key not in ('respekt', 'skal', 'eld', 'get', 'skalle') then
    raise exception 'invalid reaction';
  end if;

  select * into msg from public.messages where id = mid;
  if msg.id is null then raise exception 'message not found'; end if;
  if not public.is_group_member(msg.group_id) then raise exception 'not a member'; end if;
  if msg.user_id = auth.uid() then raise exception 'cannot react to your own message'; end if;

  pts := public.reaction_points(reaction_key);

  select id into existing from public.message_reactions
    where message_id = mid and user_id = auth.uid() and reaction = reaction_key;

  if existing is not null then
    delete from public.message_reactions where id = existing;
    perform public.award_points(
      msg.group_id, msg.user_id, -pts, 'reaction_removed:' || reaction_key,
      jsonb_build_object('message_id', mid, 'from_user', auth.uid())
    );
    return false;
  else
    insert into public.message_reactions (message_id, group_id, user_id, reaction)
      values (mid, msg.group_id, auth.uid(), reaction_key);
    perform public.award_points(
      msg.group_id, msg.user_id, pts, 'reaction:' || reaction_key,
      jsonb_build_object('message_id', mid, 'from_user', auth.uid())
    );
    return true;
  end if;
end;
$$;

revoke all on function public.toggle_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_reaction(uuid, text) to authenticated;

-- ---------- Realtime ----------

alter publication supabase_realtime add table public.message_reactions;
