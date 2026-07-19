-- ============================================================
-- Poängjakten: kategorin Baren ersätts av 🍺 Dryckesmästarn — alla
-- uppdrag som handlar om att dricka öl/drinkar, skåla och bjuda på
-- drycker. Barens tre kvarvarande icke-dryckeskort flyttas till
-- passande kategorier (Tacket -> Främlingar, Accenten -> Scenen,
-- Menymästaren -> Gänget).
-- ============================================================

alter table public.hunt_challenges
  drop constraint if exists hunt_challenges_category_check;

-- Dryckesmästarn: Trippeln, Skålen, Vattnet, Snabbtörsten, Kavaljeren,
-- Rekordet, Bjudaren, Skålmästaren, Rekordhållaren, Ambassadören, Legenden.
update public.hunt_challenges set category = 'dryck'
  where id in (3, 5, 12, 26, 48, 58, 63, 68, 89, 90, 94);

update public.hunt_challenges set category = 'social' where id = 21;  -- Tacket
update public.hunt_challenges set category = 'scen'   where id = 27;  -- Accenten
update public.hunt_challenges set category = 'gang'   where id = 41;  -- Menymästaren

alter table public.hunt_challenges
  add constraint hunt_challenges_category_check
    check (category in ('gang','social','charm','scen','fys','dryck'));

alter table public.hunt_challenges
  alter column category set default 'gang';
