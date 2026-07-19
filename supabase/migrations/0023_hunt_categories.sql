-- ============================================================
-- Poängjakten: kategorier. Varje utmaning tillhör en av sex kategorier
-- så att spelaren kan filtrera korten på typ av uppdrag, inte bara
-- nivå/status. Datadrivet som allt annat: en kolumn på hunt_challenges.
--   gang   👊 Gänget          — upptåg med polarna
--   social 🤝 Främlingar      — social mod mot okända
--   charm  💘 Charm           — romantik och raggning
--   scen   🎤 Scenen          — sång, tal och uppträdanden
--   fys    💪 Styrka & mod    — fysiska prov och vågspel
--   bar    🍻 Baren           — beställningar, skålar och dueller
-- ============================================================

alter table public.hunt_challenges
  add column if not exists category text not null default 'gang'
    check (category in ('gang','social','charm','scen','fys','bar'));

update public.hunt_challenges set category = 'social'
  where id in (2,6,8,9,23,24,28,30,40,43,47,49,52,56,59,62,65,66,67,70,71,82,85,87,99,100);

update public.hunt_challenges set category = 'charm'
  where id in (32,51,53,64,73,77,83,88,91,95);

update public.hunt_challenges set category = 'scen'
  where id in (7,13,25,31,34,35,37,38,39,45,54,55,60,61,74,75,76,79,80,84,92,96,97);

update public.hunt_challenges set category = 'fys'
  where id in (29,33,36,69,78,81,86);

update public.hunt_challenges set category = 'bar'
  where id in (3,5,12,21,26,27,41,48,58,63,68,89,90,94);

update public.hunt_challenges set category = 'gang'
  where id in (1,4,10,11,14,15,16,17,18,19,20,22,42,44,46,50,57,72,93,98);
