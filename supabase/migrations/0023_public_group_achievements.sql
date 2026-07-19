-- ============================================================
-- Offentlig topplista: en grupp (chatt) ska kunna visas för alla med
-- namn, poäng och sina achievements — men UTAN att avslöja vilka
-- deltagarna är. user_achievements är annars privat (bara egna/lagkamrater).
--
-- Denna RPC returnerar därför bara vilka badges en grupp har samlat
-- (distinkt group_id + code), aldrig user_id. Poäng och gruppnamn är redan
-- öppna via toppliste-policyn (0009); deltagarnas namn förblir skyddade av
-- profiles-RLS.
-- ============================================================

create or replace function public.public_group_achievements()
returns table (group_id uuid, code text)
language sql security definer stable set search_path = public as $$
  select distinct ua.group_id, ua.code
  from public.user_achievements ua
  where ua.group_id is not null;
$$;

revoke all on function public.public_group_achievements() from public, anon;
grant execute on function public.public_group_achievements() to authenticated;
