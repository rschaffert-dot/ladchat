-- ============================================================
-- Fem gamification-byggstenar:
-- 1) Veckosammanfattning: cron postar söndagar ett kort per grupp
--    (veckans grabb, störst käft, antal bragder).
-- 2) Streakfrys: en gratis räddning per månad när streaken brutits.
-- 3) Gruppmål: ägaren sätter teampoängsmål + deadline (visas i chatten).
-- 4) Partyläge: 2h power hour på begäran + teambonus.
-- 5) Tystnadsböter: 3+ dagars total tystnad kostar 50 teampoäng
--    (max en bot per tystnadsperiod) — bumpens eskalering.
-- ============================================================

-- ---------- 1) Veckosammanfattning ----------

create or replace function public.post_weekly_summary()
returns void language plpgsql security definer set search_path = public as $$
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

    txt := '📊 Veckans sammanfattning — 🏆 Veckans grabb: '
      || (select coalesce(display_name, email, '?') from public.profiles where id = top_scorer.user_id)
      || ' (+' || top_scorer.pts || 'p)'
      || case when top_chatter.user_id is not null then
           ' · 🗣 Störst käft: '
           || (select coalesce(display_name, email, '?') from public.profiles where id = top_chatter.user_id)
           || ' (' || top_chatter.cnt || ' medd.)'
         else '' end
      || case when feats > 0 then ' · 🃏 ' || feats || ' bragder i Poängjakten' else '' end;

    insert into public.messages (group_id, user_id, content, kind, metadata)
      values (g.id, top_scorer.user_id, txt, 'system', '{}'::jsonb);
  end loop;
end;
$$;

revoke all on function public.post_weekly_summary() from public, anon, authenticated;

-- ---------- 2) Streakfrys ----------

alter table public.streaks add column if not exists freeze_month text;

create or replace function public.use_streak_freeze(gid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.streaks%rowtype;
  this_month text := to_char(now(), 'YYYY-MM');
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;

  select * into s from public.streaks
    where group_id = gid and user_id = auth.uid() for update;
  if s.user_id is null or s.current_streak = 0 then
    raise exception 'no streak to freeze';
  end if;
  if s.freeze_month = this_month then
    raise exception 'freeze already used this month';
  end if;
  if s.last_checkin >= current_date - 1 then
    raise exception 'streak not at risk';
  end if;

  -- Frysen låtsas att gårdagen checkades in, så dagens checkin fortsätter kedjan.
  update public.streaks
    set last_checkin = current_date - 1, freeze_month = this_month
    where group_id = gid and user_id = auth.uid();
end;
$$;

revoke all on function public.use_streak_freeze(uuid) from public, anon;
grant execute on function public.use_streak_freeze(uuid) to authenticated;

-- ---------- 3) Gruppmål ----------

alter table public.groups add column if not exists goal_points integer;
alter table public.groups add column if not exists goal_deadline timestamptz;

create or replace function public.set_group_goal(
  gid uuid, target integer, deadline timestamptz
)
returns void language plpgsql security definer set search_path = public as $$
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
        '🎯 Nytt gruppmål: ' || target || ' teampoäng före '
          || to_char(deadline, 'DD Mon') || '. Kör hårt!',
        'system', '{}'::jsonb
      );
  end if;
end;
$$;

revoke all on function public.set_group_goal(uuid, integer, timestamptz) from public, anon;
grant execute on function public.set_group_goal(uuid, integer, timestamptz) to authenticated;

-- ---------- 4) Partyläge ----------

create or replace function public.start_party_mode(gid uuid)
returns void language plpgsql security definer set search_path = public as $$
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
      '🎉 PARTYLÄGE! Dubbel XP i 2 timmar och +30 teampoäng — grabbarna är samlade!',
      'system', '{}'::jsonb
    );
end;
$$;

revoke all on function public.start_party_mode(uuid) from public, anon;
grant execute on function public.start_party_mode(uuid) to authenticated;

-- ---------- 5) Tystnadsböter ----------

create or replace function public.penalize_silent_groups()
returns void language plpgsql security definer set search_path = public as $$
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
        '💀 Tre dagars total tystnad — gruppen förlorar 50 teampoäng. Skärpning, grabbar!',
        'system', '{}'::jsonb
      from public.groups gr where gr.id = g.id;
  end loop;
end;
$$;

revoke all on function public.penalize_silent_groups() from public, anon, authenticated;

-- ---------- Cron-schemaläggning (kräver pg_cron) ----------

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron saknas — veckosammanfattning/tystnadsböter schemaläggs inte.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'weekly-summary') then
    perform cron.unschedule('weekly-summary');
  end if;
  if exists (select 1 from cron.job where jobname = 'silence-penalty') then
    perform cron.unschedule('silence-penalty');
  end if;
  -- Söndagar 18:00 UTC (≈ kvällstid i Sverige) respektive dagligen 17:00 UTC.
  perform cron.schedule('weekly-summary', '0 18 * * 0', 'select public.post_weekly_summary();');
  perform cron.schedule('silence-penalty', '0 17 * * *', 'select public.penalize_silent_groups();');
end $$;
