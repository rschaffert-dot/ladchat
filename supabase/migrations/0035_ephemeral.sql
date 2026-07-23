-- ============================================================
-- Försvinnande meddelanden: ägaren väljer per grupp att meddelanden
-- auto-raderas efter 24 h eller 7 dagar. Cron städar varje timme.
-- "Det som sägs på förfesten stannar på förfesten."
-- ============================================================

alter table public.groups add column if not exists ephemeral_hours integer
  check (ephemeral_hours is null or ephemeral_hours in (24, 168));

create or replace function public.set_ephemeral(gid uuid, hours integer)
returns void language plpgsql security definer set search_path = public as $$
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
        when hours is null then '👁 Försvinnande meddelanden är avstängt.'
        when hours = 24 then '🫥 Försvinnande meddelanden PÅ — allt raderas efter 24 timmar.'
        else '🫥 Försvinnande meddelanden PÅ — allt raderas efter 7 dagar.'
      end,
      'system', '{}'::jsonb
    );
end;
$$;
revoke all on function public.set_ephemeral(uuid, integer) from public, anon;
grant execute on function public.set_ephemeral(uuid, integer) to authenticated;

create or replace function public.purge_ephemeral()
returns void language sql security definer set search_path = public as $$
  delete from public.messages m
  using public.groups g
  where m.group_id = g.id
    and g.ephemeral_hours is not null
    and m.created_at < now() - make_interval(hours => g.ephemeral_hours);
$$;
revoke all on function public.purge_ephemeral() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'purge-ephemeral') then
    perform cron.unschedule('purge-ephemeral');
  end if;
  perform cron.schedule('purge-ephemeral', '15 * * * *', 'select public.purge_ephemeral();');
end $$;
