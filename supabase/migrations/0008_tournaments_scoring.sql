-- ============================================================
-- Tävlingssystem, fas 3-4: distribution av bidrag mellan lag,
-- rangordning av mottagna bidrag, poängberäkning + bildlagring.
-- Bygger vidare på 0007_tournaments.sql.
-- ============================================================

-- Byt namn för tydlighet: kolumnen lagrar en storage-sökväg, inte en full URL
-- (klienten hämtar en signerad URL via samma RLS som gäller för raden).
alter table public.challenge_submissions rename column image_url to image_path;

-- submit_challenge_entry (0007) skrev till den gamla kolumnen — uppdatera den.
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

  insert into public.challenge_submissions (challenge_id, group_id, user_id, image_path, caption)
    values (cid, gid, auth.uid(), image_url, caption)
    returning id into sid;
  return sid;
end;
$$;

-- ---------- Tabeller ----------

create table public.challenge_team_picks (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references public.challenges(id) on delete cascade,
  group_id      uuid not null references public.groups(id) on delete cascade,
  submission_id uuid not null references public.challenge_submissions(id) on delete cascade,
  vote_count    integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (challenge_id, group_id, submission_id)
);

create table public.challenge_distributions (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references public.challenges(id) on delete cascade,
  from_group_id uuid not null references public.groups(id) on delete cascade,
  to_group_id   uuid not null references public.groups(id) on delete cascade,
  submission_id uuid not null references public.challenge_submissions(id) on delete cascade,
  created_at    timestamptz not null default now()
);

create table public.challenge_votes (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references public.challenges(id) on delete cascade,
  to_group_id   uuid not null references public.groups(id) on delete cascade,
  voter_id      uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null references public.challenge_submissions(id) on delete cascade,
  rank          integer not null check (rank >= 1),
  created_at    timestamptz not null default now(),
  unique (challenge_id, voter_id, submission_id),
  unique (challenge_id, to_group_id, voter_id, rank)
);

create table public.challenge_results (
  id                    uuid primary key default gen_random_uuid(),
  challenge_id          uuid not null references public.challenges(id) on delete cascade,
  group_id              uuid not null references public.groups(id) on delete cascade,
  aggregate_vote_score  integer not null default 0,
  points_awarded        integer not null default 0,
  created_at            timestamptz not null default now(),
  unique (challenge_id, group_id)
);

create index challenge_distributions_to_group_idx
  on public.challenge_distributions (challenge_id, to_group_id);

-- ---------- Blind röstning för mottagna bidrag ----------

create or replace function public.has_completed_ranking(cid uuid, tgid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    (select count(*) from public.challenge_distributions
       where challenge_id = cid and to_group_id = tgid) > 0
    and
    (select count(*) from public.challenge_votes
       where challenge_id = cid and to_group_id = tgid and voter_id = auth.uid())
    >=
    (select count(*) from public.challenge_distributions
       where challenge_id = cid and to_group_id = tgid);
$$;

revoke all on function public.has_completed_ranking(uuid, uuid) from public, anon;
grant execute on function public.has_completed_ranking(uuid, uuid) to authenticated;

-- ---------- RPC: tävlingsledning låser topp-3, fördelar, räknar poäng ----------

-- Topp-3 bidrag per lag (flest röster i challenge_pick_votes vinner;
-- vid lika röstetal vinner det bidrag som nådde sin senaste röst tidigast).
create or replace function public.lock_challenge_picks(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'admin only'; end if;

  with ranked as (
    select
      s.group_id,
      s.id as submission_id,
      coalesce(v.cnt, 0) as vote_count,
      row_number() over (
        partition by s.group_id
        order by coalesce(v.cnt, 0) desc, coalesce(v.last_vote_at, s.created_at) asc
      ) as rn
    from public.challenge_submissions s
    left join (
      select submission_id, count(*) as cnt, max(created_at) as last_vote_at
      from public.challenge_pick_votes
      where challenge_id = cid
      group by submission_id
    ) v on v.submission_id = s.id
    where s.challenge_id = cid
  )
  insert into public.challenge_team_picks (challenge_id, group_id, submission_id, vote_count)
  select cid, group_id, submission_id, vote_count
  from ranked
  where rn <= 3
  on conflict (challenge_id, group_id, submission_id) do nothing;

  update public.challenges set status = 'picks_locked' where id = cid;
end;
$$;

-- Fördelar varje lags topp-3 till upp till 3 andra lag (cykliskt, ingen ser sina egna).
create or replace function public.distribute_challenge(cid uuid, voting_hours numeric default 24)
returns void language plpgsql security definer set search_path = public as $$
declare
  gids         uuid[];
  n            integer;
  shown_count  integer;
  i            integer;
  j            integer;
  reviewer_idx integer;
  sub          record;
begin
  if not public.is_platform_admin() then raise exception 'admin only'; end if;

  select array_agg(distinct group_id order by group_id) into gids
    from public.challenge_team_picks where challenge_id = cid;

  n := coalesce(array_length(gids, 1), 0);
  if n < 2 then
    raise exception 'need at least 2 participating teams to distribute';
  end if;

  shown_count := least(3, n - 1);

  for i in 1..n loop
    for sub in
      select submission_id from public.challenge_team_picks
      where challenge_id = cid and group_id = gids[i]
    loop
      for j in 1..shown_count loop
        reviewer_idx := ((i - 1 + j) % n) + 1;
        insert into public.challenge_distributions
          (challenge_id, from_group_id, to_group_id, submission_id)
        values (cid, gids[i], gids[reviewer_idx], sub.submission_id);
      end loop;
    end loop;
  end loop;

  update public.challenges
    set status = 'voting', voting_deadline_at = now() + make_interval(hours => voting_hours)
    where id = cid;
end;
$$;

-- Räknar ut poäng: rank 1 (bäst) ger flest poäng, sista plats 1 poäng,
-- plus 10 poäng deltagarbonus till alla lag som faktiskt skickade in bidrag.
create or replace function public.score_challenge(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  tid uuid;
begin
  if not public.is_platform_admin() then raise exception 'admin only'; end if;

  select tournament_id into tid from public.challenges where id = cid;

  with distributed_counts as (
    select to_group_id, count(*) as cnt
    from public.challenge_distributions
    where challenge_id = cid
    group by to_group_id
  ),
  submission_scores as (
    select
      v.submission_id,
      sum(dc.cnt - v.rank + 1) as score
    from public.challenge_votes v
    join distributed_counts dc on dc.to_group_id = v.to_group_id
    where v.challenge_id = cid
    group by v.submission_id
  ),
  group_scores as (
    select
      ctp.group_id,
      coalesce(sum(ss.score), 0) as total_score
    from public.challenge_team_picks ctp
    left join submission_scores ss on ss.submission_id = ctp.submission_id
    where ctp.challenge_id = cid
    group by ctp.group_id
  ),
  ordered as (
    select
      group_id,
      total_score,
      row_number() over (order by total_score asc) as placement
    from group_scores
  )
  insert into public.challenge_results (challenge_id, group_id, aggregate_vote_score, points_awarded)
  select cid, group_id, total_score, placement + 10
  from ordered
  on conflict (challenge_id, group_id) do nothing;

  update public.tournament_entries e
    set points = e.points + r.points_awarded
    from public.challenge_results r
    where r.challenge_id = cid
      and e.tournament_id = tid
      and e.group_id = r.group_id;

  update public.challenges set status = 'completed' where id = cid;
end;
$$;

revoke all on function public.lock_challenge_picks(uuid)      from public, anon;
revoke all on function public.distribute_challenge(uuid, numeric) from public, anon;
revoke all on function public.score_challenge(uuid)            from public, anon;
grant execute on function public.lock_challenge_picks(uuid)      to authenticated;
grant execute on function public.distribute_challenge(uuid, numeric) to authenticated;
grant execute on function public.score_challenge(uuid)            to authenticated;

-- ---------- RPC: laget rangordnar sina mottagna bidrag i ett svep ----------

-- Ersätter atomiskt hela lagets tidigare rangordning (om någon finns) med den
-- nya listan, bäst till sämst. Undviker delvisa unik-krockar jämfört med att
-- sätta en rank i taget.
create or replace function public.submit_rankings(cid uuid, tgid uuid, submission_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  expected_count integer;
  i integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(tgid) then raise exception 'not a member of this group'; end if;

  if not exists (select 1 from public.challenges where id = cid and status = 'voting') then
    raise exception 'voting is not open for this challenge';
  end if;

  select count(*) into expected_count from public.challenge_distributions
    where challenge_id = cid and to_group_id = tgid;
  if expected_count = 0 then
    raise exception 'no images were distributed to your team';
  end if;
  if array_length(submission_ids, 1) is distinct from expected_count then
    raise exception 'must rank exactly % images, got %', expected_count, coalesce(array_length(submission_ids, 1), 0);
  end if;

  if exists (
    select 1 from unnest(submission_ids) as s(submission_id)
    where not exists (
      select 1 from public.challenge_distributions d
      where d.challenge_id = cid and d.to_group_id = tgid and d.submission_id = s.submission_id
    )
  ) then
    raise exception 'one or more images were not distributed to your team';
  end if;

  delete from public.challenge_votes
    where challenge_id = cid and to_group_id = tgid and voter_id = auth.uid();

  for i in 1..array_length(submission_ids, 1) loop
    insert into public.challenge_votes (challenge_id, to_group_id, voter_id, submission_id, rank)
    values (cid, tgid, auth.uid(), submission_ids[i], i);
  end loop;
end;
$$;

revoke all on function public.submit_rankings(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.submit_rankings(uuid, uuid, uuid[]) to authenticated;

-- ---------- RLS ----------

alter table public.challenge_team_picks    enable row level security;
alter table public.challenge_distributions enable row level security;
alter table public.challenge_votes         enable row level security;
alter table public.challenge_results       enable row level security;

create policy "team_picks_select_entrants_or_admin" on public.challenge_team_picks for select to authenticated
  using (public.is_platform_admin() or public.is_group_member(group_id));

create policy "distributions_select_participant_or_admin" on public.challenge_distributions for select to authenticated
  using (
    public.is_platform_admin()
    or public.is_group_member(to_group_id)
    or public.is_group_member(from_group_id)
  );

-- Kan alltid se sina egna rankningar, men bara se lagkamraters efter att
-- själv ha rankat klart alla mottagna bidrag (samma "blind"-princip som picks).
create policy "votes_select" on public.challenge_votes for select to authenticated
  using (
    public.is_group_member(to_group_id)
    and (voter_id = auth.uid() or public.has_completed_ranking(challenge_id, to_group_id))
  );

create policy "results_select_all" on public.challenge_results for select to authenticated
  using (true);

-- Bidrag blir synliga för det lag de distribuerats till (för att kunna rösta),
-- och för alla när tävlingsledningen räknat klart (offentlig topplista).
create policy "submissions_select_distributed" on public.challenge_submissions for select to authenticated
  using (
    exists (
      select 1 from public.challenge_distributions d
      where d.submission_id = challenge_submissions.id
        and public.is_group_member(d.to_group_id)
    )
  );

create policy "submissions_select_completed_challenge" on public.challenge_submissions for select to authenticated
  using (
    exists (
      select 1 from public.challenges c
      where c.id = challenge_submissions.challenge_id and c.status in ('scored', 'completed')
    )
  );

-- ---------- Realtime ----------

alter publication supabase_realtime add table public.challenge_team_picks;
alter publication supabase_realtime add table public.challenge_distributions;
alter publication supabase_realtime add table public.challenge_votes;
alter publication supabase_realtime add table public.challenge_results;

-- ============================================================
-- Bildlagring: en privat bucket där åtkomsten speglar samma regler som
-- tabell-RLS ovan (egen grupp, distribuerat till en, eller offentligt
-- när tävlingen är klar) — sökvägen är "{challenge_id}/{group_id}/fil.jpg".
-- ============================================================

insert into storage.buckets (id, name, public)
values ('challenge-submissions', 'challenge-submissions', false)
on conflict (id) do nothing;

create policy "challenge_images_insert_own_team" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'challenge-submissions'
    and public.is_group_member((split_part(name, '/', 2))::uuid)
  );

create policy "challenge_images_select_own_team" on storage.objects for select to authenticated
  using (
    bucket_id = 'challenge-submissions'
    and public.is_group_member((split_part(name, '/', 2))::uuid)
  );

create policy "challenge_images_select_distributed" on storage.objects for select to authenticated
  using (
    bucket_id = 'challenge-submissions'
    and exists (
      select 1 from public.challenge_submissions s
      join public.challenge_distributions d on d.submission_id = s.id
      where s.image_path = storage.objects.name
        and public.is_group_member(d.to_group_id)
    )
  );

create policy "challenge_images_select_public_after_scoring" on storage.objects for select to authenticated
  using (
    bucket_id = 'challenge-submissions'
    and exists (
      select 1 from public.challenge_submissions s
      join public.challenges c on c.id = s.challenge_id
      where s.image_path = storage.objects.name and c.status in ('scored', 'completed')
    )
  );
