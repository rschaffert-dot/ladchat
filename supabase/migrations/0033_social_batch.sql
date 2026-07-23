-- ============================================================
-- Stora sociala batchen:
-- 1) Gruppstreak: dagar i rad med minst ett riktigt meddelande
--    (trigger), + comeback-bonus efter 7 dagars egen tystnad.
-- 2) Vadslagning: öppna vad, anta, neutral domare avgör potten.
-- 3) Påminnelser: "påminn mig" → notis via cron var 5:e minut.
-- 4) Fredagslotteriet: 10p/lott, dragning söndag 19 UTC per grupp.
-- 5) Redigeringshistorik: originaltexten sparas i metadata.
-- 6) Schemalagda meddelanden: skriv nu, skickas senare (cron).
-- 7) LadReal: slumpad dagstid per grupp — bild inom 15 min ger +15p.
-- 8) Årskrönika: 31 december sammanfattas året per grupp.
-- ============================================================

-- ---------- 1) Gruppstreak + comeback + LadReal-belöning ----------

alter table public.groups add column if not exists msg_streak integer not null default 0;
alter table public.groups add column if not exists msg_streak_date date;

create table if not exists public.ladreal_state (
  group_id  uuid primary key references public.groups(id) on delete cascade,
  fire_date date,
  fire_hour integer,
  fired_at  timestamptz
);
alter table public.ladreal_state enable row level security;
drop policy if exists "ladreal_select_member" on public.ladreal_state;
create policy "ladreal_select_member" on public.ladreal_state
  for select to authenticated using (public.is_group_member(group_id));

create or replace function public.on_message_social()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  last_msg timestamptz;
  lr record;
begin
  if new.kind in ('system', 'poll') then return new; end if;

  -- Gruppstreak: en dag räknas när någon skriver något riktigt.
  update public.groups set
    msg_streak = case
      when msg_streak_date = current_date then msg_streak
      when msg_streak_date = current_date - 1 then msg_streak + 1
      else 1
    end,
    msg_streak_date = current_date
    where id = new.group_id;

  -- Comeback: första livstecknet på över en vecka belönas.
  select max(created_at) into last_msg from public.messages
    where group_id = new.group_id and user_id = new.user_id
      and kind not in ('system', 'poll') and id <> new.id;
  if last_msg is not null and last_msg < now() - interval '7 days' then
    perform public.award_points(new.group_id, new.user_id, 20, 'comeback', '{}'::jsonb);
    insert into public.messages (group_id, user_id, content, kind, metadata)
      values (
        new.group_id, new.user_id,
        '⚡ ' || (select coalesce(display_name, email, '?') from public.profiles where id = new.user_id)
          || ' har återuppstått efter en veckas tystnad — +20p comeback-bonus!',
        'system', '{}'::jsonb
      );
  end if;

  -- LadReal: bild inom 15 min från larmet ger +15p (en gång per larm).
  if new.kind = 'image' then
    select * into lr from public.ladreal_state
      where group_id = new.group_id and fired_at > now() - interval '15 minutes';
    if lr.group_id is not null and not exists (
      select 1 from public.point_events pe
      where pe.group_id = new.group_id and pe.user_id = new.user_id
        and pe.reason = 'ladreal' and pe.created_at >= lr.fired_at
    ) then
      perform public.award_points(new.group_id, new.user_id, 15, 'ladreal', '{}'::jsonb);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists messages_social on public.messages;
create trigger messages_social after insert on public.messages
  for each row execute function public.on_message_social();

create or replace function public.ladreal_tick()
returns void language plpgsql security definer set search_path = public as $$
declare
  g record;
  local_hour integer := extract(hour from now() at time zone 'Europe/Stockholm')::integer;
begin
  for g in select id from public.groups loop
    insert into public.ladreal_state (group_id, fire_date, fire_hour)
      values (g.id, current_date, 9 + floor(random() * 12)::integer)
      on conflict (group_id) do update
        set fire_date = current_date, fire_hour = 9 + floor(random() * 12)::integer
        where public.ladreal_state.fire_date is distinct from current_date;

    update public.ladreal_state ls set fired_at = now()
      where ls.group_id = g.id and ls.fire_date = current_date
        and ls.fire_hour = local_hour
        and (ls.fired_at is null or ls.fired_at::date < current_date);
    if found then
      insert into public.messages (group_id, user_id, content, kind, metadata)
        select g.id, gr.owner_id,
          '📸 LadReal! Posta en bild av vad du gör JUST NU inom 15 minuter — +15p till alla som hinner!',
          'system', '{}'::jsonb
        from public.groups gr where gr.id = g.id;
    end if;
  end loop;
end;
$$;
revoke all on function public.ladreal_tick() from public, anon, authenticated;

-- ---------- 2) Vadslagning ----------

create table if not exists public.bets (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  creator_id  uuid not null references auth.users(id) on delete cascade,
  acceptor_id uuid references auth.users(id) on delete set null,
  claim       text not null check (char_length(claim) between 1 and 200),
  stake       integer not null check (stake > 0),
  status      text not null default 'open'
    check (status in ('open', 'active', 'settled', 'cancelled')),
  winner_id   uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.bets enable row level security;
drop policy if exists "bets_select_member" on public.bets;
create policy "bets_select_member" on public.bets
  for select to authenticated using (public.is_group_member(group_id));

create or replace function public.create_bet(gid uuid, claim_text text, stake_amount integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;
  if stake_amount is null or stake_amount <= 0 then raise exception 'invalid stake'; end if;
  insert into public.bets (group_id, creator_id, claim, stake)
    values (gid, auth.uid(), btrim(claim_text), stake_amount);
  insert into public.messages (group_id, user_id, content, kind, metadata)
    values (
      gid, auth.uid(),
      '🤝 ' || (select coalesce(display_name, email, '?') from public.profiles where id = auth.uid())
        || ' slår vad om ' || stake_amount || 'p: "' || btrim(claim_text) || '" — vågar någon anta?',
      'system', '{}'::jsonb
    );
end;
$$;
revoke all on function public.create_bet(uuid, text, integer) from public, anon;
grant execute on function public.create_bet(uuid, text, integer) to authenticated;

create or replace function public.accept_bet(bid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  b public.bets%rowtype;
  my_pts integer;
  cr_pts integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into b from public.bets where id = bid for update;
  if b.id is null then raise exception 'bet not found'; end if;
  if b.status <> 'open' then raise exception 'bet not open'; end if;
  if b.creator_id = auth.uid() then raise exception 'cannot accept own bet'; end if;
  if not public.is_group_member(b.group_id) then raise exception 'not a member'; end if;
  select points into my_pts from public.group_members where group_id = b.group_id and user_id = auth.uid();
  select points into cr_pts from public.group_members where group_id = b.group_id and user_id = b.creator_id;
  if my_pts < b.stake or cr_pts < b.stake then raise exception 'not enough points'; end if;

  perform public.award_points(b.group_id, b.creator_id, -b.stake, 'bet_stake', jsonb_build_object('bet_id', bid));
  perform public.award_points(b.group_id, auth.uid(), -b.stake, 'bet_stake', jsonb_build_object('bet_id', bid));
  update public.bets set status = 'active', acceptor_id = auth.uid() where id = bid;
  insert into public.messages (group_id, user_id, content, kind, metadata)
    values (
      b.group_id, auth.uid(),
      '🤝 Vadet är antaget! Potten är ' || (b.stake * 2) || 'p. En neutral polare avgör vinnaren.',
      'system', '{}'::jsonb
    );
end;
$$;
revoke all on function public.accept_bet(uuid) from public, anon;
grant execute on function public.accept_bet(uuid) to authenticated;

create or replace function public.settle_bet(bid uuid, winner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  b public.bets%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into b from public.bets where id = bid for update;
  if b.id is null then raise exception 'bet not found'; end if;
  if b.status <> 'active' then raise exception 'bet not active'; end if;
  if not public.is_group_member(b.group_id) then raise exception 'not a member'; end if;
  if auth.uid() in (b.creator_id, b.acceptor_id) then
    raise exception 'only a neutral member can settle';
  end if;
  if winner not in (b.creator_id, b.acceptor_id) then raise exception 'invalid winner'; end if;

  perform public.award_points(b.group_id, winner, b.stake * 2, 'bet_win', jsonb_build_object('bet_id', bid));
  update public.bets set status = 'settled', winner_id = winner where id = bid;
  insert into public.messages (group_id, user_id, content, kind, metadata)
    values (
      b.group_id, auth.uid(),
      '🏆 ' || (select coalesce(display_name, email, '?') from public.profiles where id = winner)
        || ' vann vadet "' || b.claim || '" och tar potten på ' || (b.stake * 2) || 'p!',
      'system', '{}'::jsonb
    );
end;
$$;
revoke all on function public.settle_bet(uuid, uuid) from public, anon;
grant execute on function public.settle_bet(uuid, uuid) to authenticated;

create or replace function public.cancel_bet(bid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  b public.bets%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into b from public.bets where id = bid for update;
  if b.id is null then raise exception 'bet not found'; end if;
  if b.creator_id <> auth.uid() then raise exception 'only the creator cancels'; end if;
  if b.status <> 'open' then raise exception 'bet not open'; end if;
  update public.bets set status = 'cancelled' where id = bid;
end;
$$;
revoke all on function public.cancel_bet(uuid) from public, anon;
grant execute on function public.cancel_bet(uuid) to authenticated;

-- ---------- 3) Påminnelser ----------

create table if not exists public.reminders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  group_id   uuid not null references public.groups(id) on delete cascade,
  content    text not null,
  remind_at  timestamptz not null,
  sent       boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.reminders enable row level security;
drop policy if exists "reminders_select_own" on public.reminders;
create policy "reminders_select_own" on public.reminders
  for select to authenticated using (user_id = auth.uid());

create or replace function public.set_reminder(gid uuid, txt text, at_time timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;
  insert into public.reminders (user_id, group_id, content, remind_at)
    values (auth.uid(), gid, btrim(txt), at_time);
end;
$$;
revoke all on function public.set_reminder(uuid, text, timestamptz) from public, anon;
grant execute on function public.set_reminder(uuid, text, timestamptz) to authenticated;

create or replace function public.process_reminders()
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in select * from public.reminders where not sent and remind_at <= now() loop
    insert into public.notifications (user_id, group_id, kind, content)
      values (r.user_id, r.group_id, 'reminder', '⏰ Påminnelse: ' || r.content);
    update public.reminders set sent = true where id = r.id;
  end loop;
end;
$$;
revoke all on function public.process_reminders() from public, anon, authenticated;

-- ---------- 4) Lotteriet ----------

create table if not exists public.lottery_tickets (
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  week       text not null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id, week)
);
alter table public.lottery_tickets enable row level security;
drop policy if exists "lottery_select_member" on public.lottery_tickets;
create policy "lottery_select_member" on public.lottery_tickets
  for select to authenticated using (public.is_group_member(group_id));

create or replace function public.buy_lottery_ticket(gid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  this_week text := to_char(now(), 'IYYY-IW');
  my_pts integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;
  select points into my_pts from public.group_members where group_id = gid and user_id = auth.uid();
  if my_pts < 10 then raise exception 'not enough points'; end if;
  insert into public.lottery_tickets (group_id, user_id, week) values (gid, auth.uid(), this_week);
  perform public.award_points(gid, auth.uid(), -10, 'lottery_ticket', '{}'::jsonb);
  insert into public.messages (group_id, user_id, content, kind, metadata)
    values (
      gid, auth.uid(),
      '🎟 ' || (select coalesce(display_name, email, '?') from public.profiles where id = auth.uid())
        || ' köpte en lott till veckans lotteri! Dragning söndag kväll.',
      'system', '{}'::jsonb
    );
exception when unique_violation then
  raise exception 'already in this week';
end;
$$;
revoke all on function public.buy_lottery_ticket(uuid) from public, anon;
grant execute on function public.buy_lottery_ticket(uuid) to authenticated;

create or replace function public.draw_lottery()
returns void language plpgsql security definer set search_path = public as $$
declare
  this_week text := to_char(now(), 'IYYY-IW');
  g record;
  win record;
  pot integer;
begin
  for g in
    select group_id, count(*) as cnt from public.lottery_tickets
    where week = this_week group by group_id
  loop
    select user_id into win from public.lottery_tickets
      where group_id = g.group_id and week = this_week
      order by random() limit 1;
    pot := g.cnt * 10;
    perform public.award_points(g.group_id, win.user_id, pot, 'lottery_win', '{}'::jsonb);
    insert into public.messages (group_id, user_id, content, kind, metadata)
      values (
        g.group_id, win.user_id,
        '🎰 Lotteridragning! ' || (select coalesce(display_name, email, '?') from public.profiles where id = win.user_id)
          || ' vinner potten på ' || pot || 'p av ' || g.cnt || ' lotter!',
        'system', '{}'::jsonb
      );
  end loop;
end;
$$;
revoke all on function public.draw_lottery() from public, anon, authenticated;

-- ---------- 5) Redigeringshistorik ----------

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
    set content = btrim(new_content),
        edited_at = now(),
        metadata = m.metadata || jsonb_build_object(
          'original_content', coalesce(m.metadata->>'original_content', m.content)
        )
    where id = mid;
end;
$$;

-- ---------- 6) Schemalagda meddelanden ----------

create table if not exists public.scheduled_messages (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 2000),
  send_at    timestamptz not null,
  sent       boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.scheduled_messages enable row level security;
drop policy if exists "scheduled_select_own" on public.scheduled_messages;
create policy "scheduled_select_own" on public.scheduled_messages
  for select to authenticated using (user_id = auth.uid());

create or replace function public.schedule_message(gid uuid, txt text, at_time timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;
  if at_time <= now() then raise exception 'time must be in the future'; end if;
  insert into public.scheduled_messages (group_id, user_id, content, send_at)
    values (gid, auth.uid(), btrim(txt), at_time);
end;
$$;
revoke all on function public.schedule_message(uuid, text, timestamptz) from public, anon;
grant execute on function public.schedule_message(uuid, text, timestamptz) to authenticated;

create or replace function public.process_scheduled_messages()
returns void language plpgsql security definer set search_path = public as $$
declare
  s record;
begin
  for s in select * from public.scheduled_messages where not sent and send_at <= now() loop
    insert into public.messages (group_id, user_id, content, kind, metadata)
      values (s.group_id, s.user_id, s.content, 'user', jsonb_build_object('scheduled', true));
    update public.scheduled_messages set sent = true where id = s.id;
  end loop;
end;
$$;
revoke all on function public.process_scheduled_messages() from public, anon, authenticated;

-- ---------- 7) Årskrönika ----------

create or replace function public.post_yearly_summary()
returns void language plpgsql security definer set search_path = public as $$
declare
  g record;
  top_scorer record;
  msg_cnt integer;
  feats integer;
begin
  for g in select id, name, team_points, msg_streak from public.groups loop
    select pe.user_id, sum(pe.amount) as pts into top_scorer
      from public.point_events pe
      where pe.group_id = g.id and pe.created_at > now() - interval '365 days' and pe.amount > 0
      group by pe.user_id order by pts desc limit 1;
    if top_scorer.user_id is null then continue; end if;
    select count(*) into msg_cnt from public.messages
      where group_id = g.id and created_at > now() - interval '365 days' and kind = 'user';
    select count(*) into feats from public.hunt_completions
      where group_id = g.id and status = 'confirmed'
        and responded_at > now() - interval '365 days';
    insert into public.messages (group_id, user_id, content, kind, metadata)
      values (
        g.id, top_scorer.user_id,
        '🎆 ERT ÅR: ' || msg_cnt || ' meddelanden · 🏆 Årets grabb: '
          || (select coalesce(display_name, email, '?') from public.profiles where id = top_scorer.user_id)
          || ' (+' || top_scorer.pts || 'p) · 🃏 ' || feats || ' bragder · 🛡 '
          || g.team_points || ' teampoäng. Gott nytt år, grabbar!',
        'system', '{}'::jsonb
      );
  end loop;
end;
$$;
revoke all on function public.post_yearly_summary() from public, anon, authenticated;

-- ---------- Cron ----------

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron saknas — nya jobb schemaläggs inte.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'reminders') then
    perform cron.unschedule('reminders');
  end if;
  if exists (select 1 from cron.job where jobname = 'scheduled-messages') then
    perform cron.unschedule('scheduled-messages');
  end if;
  if exists (select 1 from cron.job where jobname = 'lottery-draw') then
    perform cron.unschedule('lottery-draw');
  end if;
  if exists (select 1 from cron.job where jobname = 'ladreal') then
    perform cron.unschedule('ladreal');
  end if;
  if exists (select 1 from cron.job where jobname = 'yearly-summary') then
    perform cron.unschedule('yearly-summary');
  end if;
  perform cron.schedule('reminders', '*/5 * * * *', 'select public.process_reminders();');
  perform cron.schedule('scheduled-messages', '*/5 * * * *', 'select public.process_scheduled_messages();');
  perform cron.schedule('lottery-draw', '0 19 * * 0', 'select public.draw_lottery();');
  perform cron.schedule('ladreal', '5 * * * *', 'select public.ladreal_tick();');
  perform cron.schedule('yearly-summary', '0 17 31 12 *', 'select public.post_yearly_summary();');
end $$;
