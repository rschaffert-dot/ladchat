-- ============================================================
-- Tävlingssystem, fas 1–2: turneringar, anmälan (mock-betalning),
-- uppdrag ("challenges"), bidrag, och blind röstning på egna bidrag.
--
-- Fas 3 (distribution mellan lag + rangordning av mottagna bidrag)
-- och fas 4 (poängberäkning + topplista) byggs i separata migrationer
-- ovanpå detta, enligt överenskommen byggordning.
--
-- OBS: ingen riktig betalleverantör (Swish/Stripe) är kopplad in än.
-- tournament_entries.payment_status sätts manuellt av tävlingsledning
-- tills dess (via set_entry_payment_status). Kolla legala aspekter
-- (Spellagen) innan riktiga pengar tas emot i produktion.
-- ============================================================

-- ---------- Tävlingsledning: en platt admin-roll, separat från gruppägarskap ----------

alter table public.profiles add column is_admin boolean not null default false;

create or replace function public.is_platform_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- ---------- Systemmeddelanden: för uppdragslänkar i chatten ----------

alter table public.messages
  add column kind text not null default 'user' check (kind in ('user', 'system')),
  add column metadata jsonb not null default '{}'::jsonb;

-- ---------- Tabeller ----------

create table public.tournaments (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 1 and 120),
  description    text,
  entry_fee_ore  integer not null default 0 check (entry_fee_ore >= 0),
  prize_pool_ore integer not null default 0 check (prize_pool_ore >= 0),
  status         text not null default 'draft'
                   check (status in ('draft', 'registration_open', 'active', 'completed')),
  created_by     uuid not null references auth.users(id) on delete cascade,
  created_at     timestamptz not null default now()
);

create table public.tournament_entries (
  id               uuid primary key default gen_random_uuid(),
  tournament_id    uuid not null references public.tournaments(id) on delete cascade,
  group_id         uuid not null references public.groups(id) on delete cascade,
  payment_status   text not null default 'pending'
                     check (payment_status in ('pending', 'paid', 'refunded', 'waived')),
  payment_reference text,
  points           integer not null default 0,
  registered_by    uuid not null references auth.users(id) on delete cascade,
  created_at       timestamptz not null default now(),
  unique (tournament_id, group_id)
);

create table public.challenges (
  id                     uuid primary key default gen_random_uuid(),
  tournament_id          uuid not null references public.tournaments(id) on delete cascade,
  title                  text not null check (char_length(title) between 1 and 200),
  description            text,
  status                 text not null default 'draft'
                           check (status in (
                             'draft', 'open', 'picks_locked', 'distributed',
                             'voting', 'scored', 'completed'
                           )),
  submission_deadline_at timestamptz,
  voting_deadline_at     timestamptz,
  created_by             uuid not null references auth.users(id) on delete cascade,
  created_at             timestamptz not null default now()
);

create table public.challenge_submissions (
  id           uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  group_id     uuid not null references public.groups(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  image_url    text not null,
  caption      text,
  created_at   timestamptz not null default now()
);

create table public.challenge_pick_votes (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references public.challenges(id) on delete cascade,
  group_id      uuid not null references public.groups(id) on delete cascade,
  voter_id      uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null references public.challenge_submissions(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (challenge_id, voter_id, submission_id)
);

create index challenge_submissions_challenge_group_idx
  on public.challenge_submissions (challenge_id, group_id);
create index challenge_pick_votes_challenge_group_idx
  on public.challenge_pick_votes (challenge_id, group_id);

-- ---------- Blind röstning: kan bara se andras röster efter att ha röstat själv ----------

create or replace function public.has_cast_pick_vote(cid uuid, gid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from public.challenge_pick_votes
    where challenge_id = cid and group_id = gid and voter_id = auth.uid()
  );
$$;

revoke all on function public.has_cast_pick_vote(uuid, uuid) from public, anon;
grant execute on function public.has_cast_pick_vote(uuid, uuid) to authenticated;

-- ---------- RPC: tävlingsledning skapar/öppnar/hanterar ----------

create or replace function public.create_tournament(
  name text, description text, entry_fee_ore integer, prize_pool_ore integer
) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if not public.is_platform_admin() then raise exception 'admin only'; end if;
  insert into public.tournaments (name, description, entry_fee_ore, prize_pool_ore, created_by)
    values (name, description, entry_fee_ore, prize_pool_ore, auth.uid())
    returning id into tid;
  return tid;
end;
$$;

create or replace function public.set_tournament_status(tid uuid, new_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'admin only'; end if;
  if new_status not in ('draft', 'registration_open', 'active', 'completed') then
    raise exception 'invalid status';
  end if;
  update public.tournaments set status = new_status where id = tid;
end;
$$;

create or replace function public.set_entry_payment_status(eid uuid, new_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'admin only'; end if;
  if new_status not in ('pending', 'paid', 'refunded', 'waived') then
    raise exception 'invalid status';
  end if;
  update public.tournament_entries set payment_status = new_status where id = eid;
end;
$$;

create or replace function public.create_challenge(tid uuid, title text, description text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not public.is_platform_admin() then raise exception 'admin only'; end if;
  insert into public.challenges (tournament_id, title, description, created_by)
    values (tid, title, description, auth.uid())
    returning id into cid;
  return cid;
end;
$$;

-- Öppnar uppdraget för insändning och postar ett systemmeddelande med länk
-- i chatten för varje lag som betalat sin anmälan till turneringen.
create or replace function public.open_challenge(cid uuid, submission_hours numeric default 72)
returns void language plpgsql security definer set search_path = public as $$
declare
  r   record;
  tid uuid;
begin
  if not public.is_platform_admin() then raise exception 'admin only'; end if;

  select tournament_id into tid from public.challenges where id = cid;
  if tid is null then raise exception 'challenge not found'; end if;

  update public.challenges
    set status = 'open',
        submission_deadline_at = now() + make_interval(hours => submission_hours)
    where id = cid;

  for r in
    select group_id from public.tournament_entries
    where tournament_id = tid and payment_status = 'paid'
  loop
    insert into public.messages (group_id, user_id, content, kind, metadata)
    values (
      r.group_id,
      auth.uid(),
      'Ett nytt uppdrag har startat! 🏆',
      'system',
      jsonb_build_object('type', 'challenge_announcement', 'challenge_id', cid)
    );
  end loop;
end;
$$;

revoke all on function public.create_tournament(text, text, integer, integer) from public, anon;
revoke all on function public.set_tournament_status(uuid, text)                from public, anon;
revoke all on function public.set_entry_payment_status(uuid, text)             from public, anon;
revoke all on function public.create_challenge(uuid, text, text)               from public, anon;
revoke all on function public.open_challenge(uuid, numeric)                    from public, anon;

grant execute on function public.create_tournament(text, text, integer, integer) to authenticated;
grant execute on function public.set_tournament_status(uuid, text)                to authenticated;
grant execute on function public.set_entry_payment_status(uuid, text)             to authenticated;
grant execute on function public.create_challenge(uuid, text, text)               to authenticated;
grant execute on function public.open_challenge(uuid, numeric)                    to authenticated;

-- ---------- RPC: lag anmäler sig ----------

create or replace function public.register_for_tournament(tid uuid, gid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member of this group'; end if;
  insert into public.tournament_entries (tournament_id, group_id, registered_by)
    values (tid, gid, auth.uid())
    returning id into eid;
  return eid;
end;
$$;

revoke all on function public.register_for_tournament(uuid, uuid) from public, anon;
grant execute on function public.register_for_tournament(uuid, uuid) to authenticated;

-- ---------- RPC: skicka in bidrag ----------

create or replace function public.submit_challenge_entry(
  cid uuid, gid uuid, image_url text, caption text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  sid      uuid;
  st       text;
  deadline timestamptz;
  tid      uuid;
  paid     text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member of this group'; end if;

  select status, submission_deadline_at, tournament_id into st, deadline, tid
    from public.challenges where id = cid;
  if st is null then raise exception 'challenge not found'; end if;
  if st <> 'open' then raise exception 'challenge is not accepting submissions'; end if;
  if deadline is not null and now() > deadline then
    raise exception 'submission deadline has passed';
  end if;

  select payment_status into paid from public.tournament_entries
    where tournament_id = tid and group_id = gid;
  if paid is distinct from 'paid' then raise exception 'team has not paid entry fee'; end if;

  insert into public.challenge_submissions (challenge_id, group_id, user_id, image_url, caption)
    values (cid, gid, auth.uid(), image_url, caption)
    returning id into sid;
  return sid;
end;
$$;

revoke all on function public.submit_challenge_entry(uuid, uuid, text, text) from public, anon;
grant execute on function public.submit_challenge_entry(uuid, uuid, text, text) to authenticated;

-- ---------- RPC: blind röstning på egna lagets bidrag (max 3 per person) ----------

create or replace function public.cast_pick_vote(cid uuid, gid uuid, sid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  st  text;
  cnt integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member of this group'; end if;

  select status into st from public.challenges where id = cid;
  if st <> 'open' then raise exception 'voting is not open for this challenge'; end if;

  if not exists (
    select 1 from public.challenge_submissions
    where id = sid and challenge_id = cid and group_id = gid
  ) then
    raise exception 'submission does not belong to this team/challenge';
  end if;

  select count(*) into cnt from public.challenge_pick_votes
    where challenge_id = cid and voter_id = auth.uid();
  if cnt >= 3 then raise exception 'you have already used all 3 votes'; end if;

  insert into public.challenge_pick_votes (challenge_id, group_id, voter_id, submission_id)
    values (cid, gid, auth.uid(), sid)
    on conflict (challenge_id, voter_id, submission_id) do nothing;
end;
$$;

create or replace function public.retract_pick_vote(cid uuid, sid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.challenge_pick_votes
    where challenge_id = cid and submission_id = sid and voter_id = auth.uid();
end;
$$;

revoke all on function public.cast_pick_vote(uuid, uuid, uuid) from public, anon;
revoke all on function public.retract_pick_vote(uuid, uuid)    from public, anon;
grant execute on function public.cast_pick_vote(uuid, uuid, uuid) to authenticated;
grant execute on function public.retract_pick_vote(uuid, uuid)    to authenticated;

-- ---------- RLS ----------

alter table public.tournaments          enable row level security;
alter table public.tournament_entries   enable row level security;
alter table public.challenges           enable row level security;
alter table public.challenge_submissions enable row level security;
alter table public.challenge_pick_votes  enable row level security;

create policy "tournaments_select_all" on public.tournaments for select to authenticated
  using (true);
create policy "tournaments_insert_admin" on public.tournaments for insert to authenticated
  with check (public.is_platform_admin() and created_by = auth.uid());
create policy "tournaments_update_admin" on public.tournaments for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "entries_select_member_or_admin" on public.tournament_entries for select to authenticated
  using (public.is_group_member(group_id) or public.is_platform_admin());
create policy "entries_update_admin" on public.tournament_entries for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "challenges_select_entrants_or_admin" on public.challenges for select to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.tournament_entries e
      where e.tournament_id = challenges.tournament_id and public.is_group_member(e.group_id)
    )
  );
create policy "challenges_update_admin" on public.challenges for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "submissions_select_own_team_or_admin" on public.challenge_submissions for select to authenticated
  using (public.is_platform_admin() or public.is_group_member(group_id));

-- Kan alltid se sina egna röster, men bara se lagkamraters röster efter att
-- själv ha röstat minst en gång i samma uppdrag+lag ("blind" tills man deltagit).
create policy "pick_votes_select" on public.challenge_pick_votes for select to authenticated
  using (
    public.is_group_member(group_id)
    and (voter_id = auth.uid() or public.has_cast_pick_vote(challenge_id, group_id))
  );

-- Inga direkta insert/update/delete-policyer på tournament_entries,
-- challenge_submissions eller challenge_pick_votes: allt går via RPC:erna
-- ovan (security definer) för att kunna validera deadlines, betalstatus,
-- ägarskap och röstgränser på ett ställe.

-- ---------- Realtime ----------

alter table public.challenges        replica identity full;
alter table public.tournament_entries replica identity full;

alter publication supabase_realtime add table public.tournaments;
alter publication supabase_realtime add table public.tournament_entries;
alter publication supabase_realtime add table public.challenges;
alter publication supabase_realtime add table public.challenge_submissions;
alter publication supabase_realtime add table public.challenge_pick_votes;
