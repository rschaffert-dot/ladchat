-- 0037: Inga emojis i systemmeddelanden.
--
-- Appens UI-chrome använder linjeikoner (src/components/AppIcon.tsx) sedan
-- emoji-städningen. Systemmeddelandena skrivs däremot server-side, så samma
-- städning måste göras här — annars poppar emojis upp i chatten så fort
-- något händer i spelen, duellerna eller aktiveringarna.
--
-- Funktionerna nedan är hämtade med pg_get_functiondef() ur den körande
-- databasen, så de speglar exakt vad som gäller idag; enda skillnaden är att
-- emojitecknen är borttagna ur strängarna. CREATE OR REPLACE behåller
-- befintliga rättigheter, så inga GRANT/REVOKE behöver upprepas.
--
-- Emojis i användarnas egna meddelanden och i reaktioner berörs inte.

CREATE OR REPLACE FUNCTION public.accept_bet(bid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'Vadet är antaget! Potten är ' || (b.stake * 2) || 'p. En neutral polare avgör vinnaren.',
      'system', '{}'::jsonb
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.buy_lottery_ticket(gid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      '' || (select coalesce(display_name, email, '?') from public.profiles where id = auth.uid())
        || ' köpte en lott till veckans lotteri! Dragning söndag kväll.',
      'system', '{}'::jsonb
    );
exception when unique_violation then
  raise exception 'already in this week';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_group_activation(aid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    summary := '' || a.name || ' avslutades — ingen deltog den här gången.';
  else
    summary := '' || a.name || ' är avgjord! Vinnare: ' || winner || '. Kolla topplistan!';
  end if;

  update public.group_activations
    set status = 'completed', completed_at = now() where id = aid;

  insert into public.messages (group_id, user_id, content, kind, metadata)
    values (a.group_id, owner, summary, 'system',
      jsonb_build_object('type', 'activation_completed', 'activation_id', aid));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_bet(gid uuid, claim_text text, stake_amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;
  if stake_amount is null or stake_amount <= 0 then raise exception 'invalid stake'; end if;
  insert into public.bets (group_id, creator_id, claim, stake)
    values (gid, auth.uid(), btrim(claim_text), stake_amount);
  insert into public.messages (group_id, user_id, content, kind, metadata)
    values (
      gid, auth.uid(),
      '' || (select coalesce(display_name, email, '?') from public.profiles where id = auth.uid())
        || ' slår vad om ' || stake_amount || 'p: "' || btrim(claim_text) || '" — vågar någon anta?',
      'system', '{}'::jsonb
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_duel(gid uuid, opponent uuid, stake_amount integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  did      uuid;
  my_pts   integer;
  opp_pts  integer;
  my_name  text;
  opp_name text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;
  if opponent = auth.uid() then raise exception 'cannot duel yourself'; end if;
  if stake_amount is null or stake_amount <= 0 then raise exception 'invalid stake'; end if;
  if not exists (select 1 from public.group_members where group_id = gid and user_id = opponent) then
    raise exception 'opponent not a member';
  end if;
  if exists (select 1 from public.duels where group_id = gid and status in ('pending', 'active')) then
    raise exception 'duel already in progress';
  end if;

  select points into my_pts from public.group_members where group_id = gid and user_id = auth.uid();
  select points into opp_pts from public.group_members where group_id = gid and user_id = opponent;
  if my_pts < stake_amount then raise exception 'not enough points'; end if;
  if opp_pts < stake_amount then raise exception 'opponent has not enough points'; end if;

  insert into public.duels (group_id, challenger_id, opponent_id, stake)
    values (gid, auth.uid(), opponent, stake_amount)
    returning id into did;

  select coalesce(display_name, email, '?') into my_name from public.profiles where id = auth.uid();
  select coalesce(display_name, email, '?') into opp_name from public.profiles where id = opponent;
  perform public.duel_system_message(
    gid, auth.uid(),
    '' || my_name || ' utmanar ' || opp_name || ' på duell om ' || stake_amount || ' poäng!',
    did
  );

  return did;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_poll(gid uuid, question text, options text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    values (gid, auth.uid(), '' || question, 'poll', jsonb_build_object('poll_id', pid));

  return pid;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_wager(gid uuid, question text, wkind text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  wid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;
  if wkind not in ('time', 'number') then raise exception 'invalid wager kind'; end if;

  insert into public.wagers (group_id, question, kind, created_by)
    values (gid, question, wkind, auth.uid())
    returning id into wid;

  insert into public.messages (group_id, user_id, content, kind, metadata)
    values (gid, auth.uid(), '' || question, 'wager', jsonb_build_object('wager_id', wid));

  return wid;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.draw_lottery()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        'Lotteridragning! ' || (select coalesce(display_name, email, '?') from public.profiles where id = win.user_id)
          || ' vinner potten på ' || pot || 'p av ' || g.cnt || ' lotter!',
        'system', '{}'::jsonb
      );
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_message_energy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cur_energy  integer;
  cur_updated timestamptz;
  decayed     integer;
  new_energy  integer;
begin
  select energy, energy_updated_at into cur_energy, cur_updated
    from public.groups where id = new.group_id for update;

  decayed := greatest(0, cur_energy - floor(extract(epoch from (now() - cur_updated)) / 120)::integer);
  new_energy := least(100, decayed + 4);

  update public.groups
    set energy = new_energy, energy_updated_at = now()
    where id = new.group_id;

  if new.kind = 'user'
     and new_energy >= 80
     and random() < 0.05
     and not exists (select 1 from public.power_hours where group_id = new.group_id and ends_at > now())
     and not exists (select 1 from public.power_hours where group_id = new.group_id and starts_at > now() - interval '3 hours')
  then
    insert into public.power_hours (group_id, ends_at) values (new.group_id, now() + interval '1 hour');
    insert into public.messages (group_id, user_id, content, kind, metadata)
      values (new.group_id, new.user_id, 'POWER HOUR! Dubbel XP i 60 minuter — kör!', 'system',
              jsonb_build_object('power_hour', true));
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.hunt_respond(completion_id uuid, approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  comp record;
  ch record;
  pts integer;
  claimant_name text;
  witness_name text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into comp
    from public.hunt_completions
    where id = completion_id and witness_user_id = auth.uid() and status = 'pending'
    for update;
  if not found then raise exception 'no pending completion to respond to'; end if;

  select * into ch from public.hunt_challenges where id = comp.challenge_id;

  select coalesce(display_name, email, 'Någon') into claimant_name
    from public.profiles where id = comp.user_id;
  select coalesce(display_name, email, 'Någon') into witness_name
    from public.profiles where id = auth.uid();

  if approve then
    pts := ch.points
      + case when comp.bonus_claimed then coalesce(ch.bonus_points, 0) else 0 end;

    update public.hunt_completions
      set status = 'confirmed', points_awarded = pts, responded_at = now()
      where id = comp.id;

    perform public.award_points(
      comp.group_id, comp.user_id, pts, 'hunt_challenge',
      jsonb_build_object(
        'challenge_id', ch.id, 'challenge', ch.name, 'tier', ch.tier,
        'bonus', comp.bonus_claimed, 'witness', auth.uid()
      )
    );

    perform public.award_team_points(
      comp.group_id, 10, 'hunt_team_support',
      jsonb_build_object('challenge_id', ch.id, 'challenge', ch.name, 'user', comp.user_id)
    );

    insert into public.messages (group_id, user_id, content, kind, metadata)
      values (
        comp.group_id, comp.user_id,
        '' || claimant_name || ' klarade "' || ch.name || '" i Poängjakten — +'
          || pts || ' poäng! Intygat av ' || witness_name || '. Gruppen får +10 teampoäng.',
        'system',
        jsonb_build_object('hunt_challenge_id', ch.id)
      );

    insert into public.notifications (user_id, group_id, kind, content)
      values (
        comp.user_id, comp.group_id, 'hunt_confirmed',
        '' || witness_name || ' intygade "' || ch.name || '" — +' || pts || ' poäng!'
      );
  else
    update public.hunt_completions
      set status = 'denied', responded_at = now()
      where id = comp.id;

    insert into public.notifications (user_id, group_id, kind, content)
      values (
        comp.user_id, comp.group_id, 'hunt_denied',
        '' || witness_name || ' nekade "' || ch.name || '". Du kan försöka igen.'
      );
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ladreal_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          'LadReal! Posta en bild av vad du gör JUST NU inom 15 minuter — +15p till alla som hinner!',
          'system', '{}'::jsonb
        from public.groups gr where gr.id = g.id;
    end if;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.on_message_social()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  last_msg timestamptz;
  lr record;
begin
  if new.kind in ('system', 'poll') then return new; end if;

  update public.groups set
    msg_streak = case
      when msg_streak_date = current_date then msg_streak
      when msg_streak_date = current_date - 1 then msg_streak + 1
      else 1
    end,
    msg_streak_date = current_date
    where id = new.group_id;

  select max(created_at) into last_msg from public.messages
    where group_id = new.group_id and user_id = new.user_id
      and kind not in ('system', 'poll') and id <> new.id;
  if last_msg is not null and last_msg < now() - interval '7 days' then
    perform public.award_points(new.group_id, new.user_id, 20, 'comeback', '{}'::jsonb);
    insert into public.messages (group_id, user_id, content, kind, metadata)
      values (
        new.group_id, new.user_id,
        '' || (select coalesce(display_name, email, '?') from public.profiles where id = new.user_id)
          || ' har återuppstått efter en veckas tystnad — +20p comeback-bonus!',
        'system', '{}'::jsonb
      );
  end if;

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
$function$
;

CREATE OR REPLACE FUNCTION public.open_challenge(cid uuid, submission_hours numeric DEFAULT 72)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'Ett nytt uppdrag har startat!',
      'system',
      jsonb_build_object('type', 'challenge_announcement', 'challenge_id', cid)
    );
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.penalize_silent_groups()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g record;
begin
  for g in
    select gr.id from public.groups gr
    where not exists (
      select 1 from public.messages m
      where m.group_id = gr.id and m.created_at > now() - interval '3 days'
    )
    and exists (select 1 from public.messages m2 where m2.group_id = gr.id)
    and not exists (
      select 1 from public.team_point_events tpe
      where tpe.group_id = gr.id and tpe.reason = 'silence_penalty'
        and tpe.created_at > now() - interval '3 days'
    )
  loop
    perform public.award_team_points(g.id, -50, 'silence_penalty', '{}'::jsonb);
    insert into public.messages (group_id, user_id, content, kind, metadata)
      select g.id, gr.owner_id,
        'Tre dagars total tystnad — gruppen förlorar 50 teampoäng. Skärpning, grabbar!',
        'system', '{}'::jsonb
      from public.groups gr where gr.id = g.id;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.post_weekly_summary()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g record;
  top_scorer record;
  top_chatter record;
  feats integer;
  txt text;
begin
  for g in select id from public.groups loop
    select pe.user_id, sum(pe.amount) as pts into top_scorer
      from public.point_events pe
      where pe.group_id = g.id
        and pe.created_at > now() - interval '7 days'
        and pe.amount > 0
      group by pe.user_id order by pts desc limit 1;
    if top_scorer.user_id is null then continue; end if;

    select m.user_id, count(*) as cnt into top_chatter
      from public.messages m
      where m.group_id = g.id
        and m.created_at > now() - interval '7 days'
        and m.kind = 'user'
      group by m.user_id order by cnt desc limit 1;

    select count(*) into feats from public.hunt_completions hc
      where hc.group_id = g.id and hc.status = 'confirmed'
        and hc.responded_at > now() - interval '7 days';

    txt := 'Veckans sammanfattning — Veckans grabb: '
      || (select coalesce(display_name, email, '?') from public.profiles where id = top_scorer.user_id)
      || ' (+' || top_scorer.pts || 'p)'
      || case when top_chatter.user_id is not null then
           ' · Störst käft: '
           || (select coalesce(display_name, email, '?') from public.profiles where id = top_chatter.user_id)
           || ' (' || top_chatter.cnt || ' medd.)'
         else '' end
      || case when feats > 0 then ' · ' || feats || ' bragder i Poängjakten' else '' end;

    insert into public.messages (group_id, user_id, content, kind, metadata)
      values (g.id, top_scorer.user_id, txt, 'system', '{}'::jsonb);
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.post_yearly_summary()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        'ERT ÅR: ' || msg_cnt || ' meddelanden · Årets grabb: '
          || (select coalesce(display_name, email, '?') from public.profiles where id = top_scorer.user_id)
          || ' (+' || top_scorer.pts || 'p) · ' || feats || ' bragder · '
          || g.team_points || ' teampoäng. Gott nytt år, grabbar!',
        'system', '{}'::jsonb
      );
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.process_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
begin
  for r in select * from public.reminders where not sent and remind_at <= now() loop
    insert into public.notifications (user_id, group_id, kind, content)
      values (r.user_id, r.group_id, 'reminder', 'Påminnelse: ' || r.content);
    update public.reminders set sent = true where id = r.id;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.respond_duel(did uuid, accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d public.duels%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into d from public.duels where id = did for update;
  if d.id is null then raise exception 'duel not found'; end if;
  if d.opponent_id <> auth.uid() then raise exception 'only the opponent can respond'; end if;
  if d.status <> 'pending' then raise exception 'duel not pending'; end if;

  if not accept then
    update public.duels set status = 'declined' where id = did;
    perform public.duel_system_message(d.group_id, auth.uid(), 'Duellen avböjdes.', did);
    return;
  end if;

  perform public.award_points(d.group_id, d.challenger_id, -d.stake, 'duel_stake', jsonb_build_object('duel_id', did));
  perform public.award_points(d.group_id, d.opponent_id,   -d.stake, 'duel_stake', jsonb_build_object('duel_id', did));

  update public.duels
    set status = 'active', ends_at = now() + interval '15 minutes'
    where id = did;

  perform public.duel_system_message(
    d.group_id, auth.uid(),
    'Duellen är igång! Rösta på vinnaren inom 15 minuter.',
    did
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_ephemeral(gid uuid, hours integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.groups where id = gid and owner_id = auth.uid()) then
    raise exception 'only the owner';
  end if;
  if hours is not null and hours not in (24, 168) then raise exception 'invalid hours'; end if;
  update public.groups set ephemeral_hours = hours where id = gid;
  insert into public.messages (group_id, user_id, content, kind, metadata)
    values (
      gid, auth.uid(),
      case
        when hours is null then 'Försvinnande meddelanden är avstängt.'
        when hours = 24 then 'Försvinnande meddelanden PÅ — allt raderas efter 24 timmar.'
        else 'Försvinnande meddelanden PÅ — allt raderas efter 7 dagar.'
      end,
      'system', '{}'::jsonb
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_group_goal(gid uuid, target integer, deadline timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.groups where id = gid and owner_id = auth.uid()) then
    raise exception 'only the owner sets goals';
  end if;
  update public.groups set goal_points = target, goal_deadline = deadline where id = gid;
  if target is not null then
    insert into public.messages (group_id, user_id, content, kind, metadata)
      values (
        gid, auth.uid(),
        'Nytt gruppmål: ' || target || ' teampoäng före '
          || to_char(deadline, 'DD Mon') || '. Kör hårt!',
        'system', '{}'::jsonb
      );
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_bet(bid uuid, winner uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      '' || (select coalesce(display_name, email, '?') from public.profiles where id = winner)
        || ' vann vadet "' || b.claim || '" och tar potten på ' || (b.stake * 2) || 'p!',
      'system', '{}'::jsonb
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_duel(did uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d          public.duels%rowtype;
  ch_votes   integer;
  op_votes   integer;
  win        uuid;
  win_name   text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into d from public.duels where id = did for update;
  if d.id is null then raise exception 'duel not found'; end if;
  if not public.is_group_member(d.group_id) then raise exception 'not a member'; end if;
  if d.status <> 'active' then return; end if;
  if now() < d.ends_at then raise exception 'voting still open'; end if;

  select count(*) filter (where voted_for = d.challenger_id),
         count(*) filter (where voted_for = d.opponent_id)
    into ch_votes, op_votes
    from public.duel_votes where duel_id = did;

  if ch_votes = op_votes then
    perform public.award_points(d.group_id, d.challenger_id, d.stake, 'duel_refund', jsonb_build_object('duel_id', did));
    perform public.award_points(d.group_id, d.opponent_id,   d.stake, 'duel_refund', jsonb_build_object('duel_id', did));
    update public.duels set status = 'finished', winner_id = null where id = did;
    perform public.duel_system_message(d.group_id, auth.uid(), 'Duellen slutade oavgjort — insatserna går tillbaka.', did);
    return;
  end if;

  win := case when ch_votes > op_votes then d.challenger_id else d.opponent_id end;
  perform public.award_points(d.group_id, win, d.stake * 2, 'duel_win', jsonb_build_object('duel_id', did));
  update public.duels set status = 'finished', winner_id = win where id = did;

  select coalesce(display_name, email, '?') into win_name from public.profiles where id = win;
  perform public.duel_system_message(
    d.group_id, auth.uid(),
    '' || win_name || ' vann duellen och tar potten på ' || (d.stake * 2) || ' poäng!',
    did
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_wager(wid uuid, actual_value numeric, actual_label text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  w        public.wagers%rowtype;
  best     numeric;
  winners  uuid[];
  names    text;
  winlabel text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into w from public.wagers where id = wid;
  if w.id is null then raise exception 'wager not found'; end if;
  if w.created_by <> auth.uid() then raise exception 'only the creator can settle'; end if;
  if w.settled_at is not null then raise exception 'wager already settled'; end if;
  if w.kind = 'time' and (actual_value < 0 or actual_value > 1439) then
    raise exception 'time results are minutes since midnight (0-1439)';
  end if;
  if not exists (select 1 from public.wager_guesses where wager_id = wid) then
    raise exception 'no guesses yet';
  end if;

  -- Minsta avstånd; klockslag mäts runt midnatt.
  select min(case when w.kind = 'time'
                  then least(abs(value - actual_value), 1440 - abs(value - actual_value))
                  else abs(value - actual_value) end)
    into best
    from public.wager_guesses where wager_id = wid;

  select array_agg(user_id)
    into winners
    from public.wager_guesses
    where wager_id = wid
      and (case when w.kind = 'time'
                then least(abs(value - actual_value), 1440 - abs(value - actual_value))
                else abs(value - actual_value) end) = best;

  update public.wagers
    set settled_at = now(), result_value = actual_value,
        result_label = actual_label, winner_ids = winners
    where id = wid;

  -- Vinstpoäng via den delade motorn.
  perform public.award_points(w.group_id, u, 15, 'wager_win', jsonb_build_object('wager_id', wid))
    from unnest(winners) as u;

  select string_agg(coalesce(p.display_name, p.email, 'Okänd'), ', ')
    into names
    from unnest(winners) as u
    join public.profiles p on p.id = u;

  select label into winlabel
    from public.wager_guesses
    where wager_id = wid and user_id = winners[1];

  insert into public.messages (group_id, user_id, content, kind, metadata)
    values (
      w.group_id, auth.uid(),
      '"' || w.question || '" avgjord! Facit: ' || actual_label ||
        '. Närmast: ' || names || ' (' || winlabel || ') — +15 poäng!',
      'system', jsonb_build_object('wager_id', wid)
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.start_drinking_game(gid uuid, game_name text, participant_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  pid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;
  if participant_ids is null or array_length(participant_ids, 1) < 2 then
    raise exception 'games need at least 2 participants';
  end if;

  foreach pid in array participant_ids loop
    if not exists (
      select 1 from public.group_members where group_id = gid and user_id = pid
    ) then
      raise exception 'participant not a member';
    end if;
  end loop;

  foreach pid in array participant_ids loop
    perform public.award_points(
      gid, pid, 10, 'game_participation',
      jsonb_build_object('game', game_name, 'started_by', auth.uid())
    );
  end loop;

  perform public.award_team_points(
    gid, 20, 'game_started',
    jsonb_build_object('game', game_name, 'started_by', auth.uid())
  );

  insert into public.messages (group_id, user_id, content, kind, metadata)
  values (
    gid, auth.uid(),
    '' || game_name || ' har startat med ' || array_length(participant_ids, 1) ||
      ' spelare — alla får +10 poäng och gruppen +20 teampoäng!',
    'system',
    jsonb_build_object('game', game_name)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.start_group_activation(gid uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    when 'thumb_order' then 'Chatten har somnat! ' || act.name ||
      ' — alla skickar en nu. Först in får flest poäng!'
    when 'longest_fart' then 'Chatten har somnat! ' || act.name ||
      ' — ladda upp en prutt. Längst inspelning vinner!'
    else 'Dags att väcka chatten: ' || act.name || '!'
  end;

  insert into public.messages (group_id, user_id, content, kind, metadata)
    values (gid, owner, intro, 'system',
      jsonb_build_object('type', 'activation_started', 'activation_id', aid, 'activity_kind', act.kind));

  return aid;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.start_party_mode(gid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;
  if exists (
    select 1 from public.power_hours where group_id = gid and ends_at > now()
  ) then
    raise exception 'party already running';
  end if;

  insert into public.power_hours (group_id, starts_at, ends_at)
    values (gid, now(), now() + interval '2 hours');

  perform public.award_team_points(gid, 30, 'party_mode',
    jsonb_build_object('started_by', auth.uid()));

  insert into public.messages (group_id, user_id, content, kind, metadata)
    values (
      gid, auth.uid(),
      'PARTYLÄGE! Dubbel XP i 2 timmar och +30 teampoäng — grabbarna är samlade!',
      'system', '{}'::jsonb
    );
end;
$function$;

-- grant_achievement hämtade emojin ur achievements.emoji i stället för ur en
-- litteral, så den syns inte i städningen ovan. Klienten visar numera ikoner
-- per trofékod (src/lib/achievements.ts) och kolumnen används inte längre för
-- visning — därför faller den bort ur notistexten här.
CREATE OR REPLACE FUNCTION public.grant_achievement(uid uuid, badge text, gid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  inserted boolean;
  a public.achievements%rowtype;
begin
  insert into public.user_achievements (user_id, code, group_id)
    values (uid, badge, gid)
    on conflict (user_id, code) do nothing;
  inserted := found;
  if inserted then
    select * into a from public.achievements where code = badge;
    insert into public.notifications (user_id, group_id, kind, content)
      values (uid, gid, 'achievement', 'Ny trofé: ' || a.name || '!');
  end if;
end;
$function$;
