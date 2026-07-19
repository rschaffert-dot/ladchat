-- ============================================================
-- Poängjakten: 100 utmaningar (kort i tarot-/spelkortsstil) som klaras
-- ute i verkligheten. Flöde: spelaren klarmarkerar med ett vittne ur
-- samma grupp -> vittnet får en notis och bekräftar/nekar -> vid
-- bekräftelse låses poängen och skrivs via den delade poängmotorn
-- (award_points -> point_events + group_members.points).
-- Kortdata är datadriven: hunt_challenges seedas här och kan utökas
-- med nya rader utan kodändringar.
-- ============================================================

-- ---------- Kortbiblioteket ----------

create table if not exists public.hunt_challenges (
  id                integer primary key,
  name              text not null,
  tier              text not null check (tier in ('wood','bronze','silver','gold','diamond')),
  points            integer not null check (points > 0),
  bonus_points      integer,
  bonus_condition   text,
  description       text not null,
  background_theme  text not null,
  requires_alcohol  boolean not null default false
);

alter table public.hunt_challenges enable row level security;

drop policy if exists "hunt_challenges_select" on public.hunt_challenges;
create policy "hunt_challenges_select" on public.hunt_challenges
  for select to authenticated using (true);

-- ---------- Klarmarkeringar ----------

create table if not exists public.hunt_completions (
  id               uuid primary key default gen_random_uuid(),
  challenge_id     integer not null references public.hunt_challenges(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  group_id         uuid not null references public.groups(id) on delete cascade,
  witness_user_id  uuid not null references auth.users(id) on delete cascade,
  bonus_claimed    boolean not null default false,
  status           text not null default 'pending' check (status in ('pending','confirmed','denied')),
  proof_url        text,
  points_awarded   integer not null default 0,
  created_at       timestamptz not null default now(),
  responded_at     timestamptz,
  unique (challenge_id, user_id)
);

create index if not exists hunt_completions_user_idx
  on public.hunt_completions (user_id);
create index if not exists hunt_completions_witness_pending_idx
  on public.hunt_completions (witness_user_id) where status = 'pending';

alter table public.hunt_completions enable row level security;

drop policy if exists "hunt_completions_select" on public.hunt_completions;
create policy "hunt_completions_select" on public.hunt_completions
  for select to authenticated
  using (
    user_id = auth.uid()
    or witness_user_id = auth.uid()
    or public.is_group_member(group_id)
  );

-- Inga insert/update-policys: alla skrivningar går via RPC:erna nedan.

-- ---------- Klarmarkera (spelaren) ----------

create or replace function public.hunt_claim(
  cid integer, gid uuid, witness uuid, bonus boolean default false
)
returns void language plpgsql security definer set search_path = public as $$
declare
  ch record;
  existing record;
  claimant_name text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if witness = auth.uid() then raise exception 'witness cannot be yourself'; end if;
  if not public.is_group_member(gid) then raise exception 'not a member'; end if;
  if not exists (
    select 1 from public.group_members where group_id = gid and user_id = witness
  ) then
    raise exception 'witness not a member of the group';
  end if;

  select * into ch from public.hunt_challenges where id = cid;
  if not found then raise exception 'unknown challenge'; end if;
  if ch.bonus_points is null then bonus := false; end if;

  select * into existing
    from public.hunt_completions
    where challenge_id = cid and user_id = auth.uid();

  if found then
    if existing.status <> 'denied' then raise exception 'already claimed'; end if;
    -- Nekad förra gången: nytt försök återanvänder raden.
    update public.hunt_completions
      set group_id = gid, witness_user_id = witness, bonus_claimed = bonus,
          status = 'pending', created_at = now(), responded_at = null
      where id = existing.id;
  else
    insert into public.hunt_completions (challenge_id, user_id, group_id, witness_user_id, bonus_claimed)
      values (cid, auth.uid(), gid, witness, bonus);
  end if;

  select coalesce(display_name, email, 'Någon') into claimant_name
    from public.profiles where id = auth.uid();

  insert into public.notifications (user_id, group_id, kind, content)
    values (
      witness, gid, 'hunt_witness',
      '🃏 ' || claimant_name || ' vill att du intygar "' || ch.name || '" i Poängjakten.'
    );
end;
$$;

revoke all on function public.hunt_claim(integer, uuid, uuid, boolean) from public, anon;
grant execute on function public.hunt_claim(integer, uuid, uuid, boolean) to authenticated;

-- ---------- Bekräfta/neka (vittnet) ----------

create or replace function public.hunt_respond(completion_id uuid, approve boolean)
returns void language plpgsql security definer set search_path = public as $$
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

    insert into public.messages (group_id, user_id, content, kind, metadata)
      values (
        comp.group_id, comp.user_id,
        '🃏 ' || claimant_name || ' klarade "' || ch.name || '" i Poängjakten — +'
          || pts || ' poäng! Intygat av ' || witness_name || '.',
        'system',
        jsonb_build_object('hunt_challenge_id', ch.id)
      );

    insert into public.notifications (user_id, group_id, kind, content)
      values (
        comp.user_id, comp.group_id, 'hunt_confirmed',
        '✅ ' || witness_name || ' intygade "' || ch.name || '" — +' || pts || ' poäng!'
      );
  else
    update public.hunt_completions
      set status = 'denied', responded_at = now()
      where id = comp.id;

    insert into public.notifications (user_id, group_id, kind, content)
      values (
        comp.user_id, comp.group_id, 'hunt_denied',
        '❌ ' || witness_name || ' nekade "' || ch.name || '". Du kan försöka igen.'
      );
  end if;
end;
$$;

revoke all on function public.hunt_respond(uuid, boolean) from public, anon;
grant execute on function public.hunt_respond(uuid, boolean) to authenticated;

-- ---------- Seed: de 100 utmaningarna ----------

insert into public.hunt_challenges
  (id, name, tier, points, bonus_points, bonus_condition, description, background_theme, requires_alcohol)
values
  -- 🪵 Trä (5–10 p)
  (1,  'Skoavtaget',        'wood', 5,  null, null, 'Ta av dig skorna och gå i bara strumpor resten av rundan.', 'Ett par slitna skor vid en dörr, stilleben i gammal gravyrstil.', false),
  (2,  'Främlingens hälsning', 'wood', 5, null, null, 'Gå fram och hälsa artigt på en helt okänd person.', 'Två händer som skakar, vintage kopparstick.', false),
  (3,  'Trippeln',          'wood', 10, null, null, 'Beställ tre öl (eller alkoholfritt) samtidigt i baren.', 'Tre skummande sejdlar på ett mörkt träbord.', true),
  (4,  'Selfietagen',       'wood', 5,  null, null, 'Ta en selfie med hela grabbgänget.', 'Gammaldags balgkamera och porträttram.', false),
  (5,  'Skålen',            'wood', 5,  null, null, 'Res dig och utbringa en skål för bordet.', 'Höjda glas i gyllene ljus.', false),
  (6,  'Namnet',            'wood', 10, null, null, 'Lär dig namnet på en person du inte känner sedan tidigare.', 'Gammal namnbricka med kalligrafi.', false),
  (7,  'Dansstegen',        'wood', 10, null, null, 'Dansa i minst 15 sekunder, var som helst.', 'Dansande siluett i art deco-stil.', false),
  (8,  'Komplimangen',      'wood', 10, null, null, 'Ge en främling en ärlig, hyfsad komplimang.', 'En enda röd ros, romantisk vinjett.', false),
  (9,  'High fiven',        'wood', 5,  null, null, 'Ge tre olika personer en high five.', 'Två händer möts i en high five, dynamisk gravyr.', false),
  (10, 'Grimasen',          'wood', 5,  null, null, 'Ta ett foto med din absolut fulaste min.', 'Teatermask, komedi och tragedi.', false),
  (11, 'Segergesten',       'wood', 5,  null, null, 'Res dig och sträck på dig som en mästare.', 'Segrare med armarna i luften, siluett.', false),
  (12, 'Vattnet',           'wood', 5,  null, null, 'Drick ett helt glas vatten – håll dig i form!', 'Kristallklart glas vatten, rent stilleben.', false),
  (13, 'Sångraden',         'wood', 10, null, null, 'Sjung en rad ur en känd låt högt.', 'Retro mikrofon med ljuskrans.', false),
  (14, 'Ryggdunken',        'wood', 5,  null, null, 'Ge en polare en rejäl ryggdunk och ett tack.', 'Två kamrater sedda bakifrån, brödraskap.', false),
  (15, 'Ordvitsen',         'wood', 10, null, null, 'Dra en riktigt usel ordvits för bordet.', 'Skrattande komedimask.', false),
  (16, 'Kamerarullen',      'wood', 10, null, null, 'Visa senaste bilden i din kamerarulle för gruppen.', 'Öppet fotoalbum, vintage.', false),
  (17, 'Emojimeddelandet',  'wood', 5,  null, null, 'Skriv ett meddelande med enbart emojis i Ladchat.', 'Egyptiska hieroglyfer på sten.', false),
  (18, 'Statyn',            'wood', 5,  null, null, 'Frys som en staty i 10 sekunder.', 'Grekisk marmorstaty.', false),
  (19, 'Platsbytet',        'wood', 5,  null, null, 'Byt plats med personen bredvid dig.', 'Schackpjäser på ett rutigt bräde.', false),
  (20, 'Applåden',          'wood', 10, null, null, 'Få bordet att applådera helt utan anledning.', 'Klappande händer, teatergravyr.', false),
  (21, 'Tacket',            'wood', 5,  null, null, 'Tacka bartendern personligen och med känsla.', 'Bardisk med glänsande glas.', false),
  (22, 'Främmande tungan',  'wood', 10, null, null, 'Räkna till tio på ett språk du inte kan.', 'Gammal världskarta och jordglob.', false),
  (23, 'Hattbytet',         'wood', 10, null, null, 'Låna någons huvudbonad och bär den en stund.', 'Rad av vintage-hattar på hattställ.', false),
  (24, 'Blinkningen',       'wood', 5,  null, null, 'Ge någon en teatralisk, överdriven blinkning.', 'Ett öga i art nouveau-ram.', false),
  (25, 'Presentationen',    'wood', 10, null, null, 'Res dig och presentera dig för bordet med en påhittad titel.', 'Gentlemannasiluett med cylinderhatt.', false),

  -- 🥉 Brons (15–20 p)
  (26, 'Snabbtörsten',      'bronze', 15, 5,  'Under 6 sekunder', 'Drick en öl (eller alkoholfritt) på under 10 sekunder.', 'Ölglas med yrande skum, dynamisk rörelse.', true),
  (27, 'Accenten',          'bronze', 15, 10, 'Bartendern tror på accenten', 'Beställ en dryck på en påhittad accent utan att spricka.', 'Mustaschprydd gentleman, teatermask.', false),
  (28, 'Fotografen',        'bronze', 20, 10, 'Någon gör en tokig min', 'Ta en gruppselfie med tre främlingar.', 'Paparazziblixtar i natten.', false),
  (29, 'Golvgorillan',      'bronze', 20, null, null, 'Gör 20 armhävningar där du står.', 'Cirkusstyrkeman / gorilla i gammal affischstil.', false),
  (30, 'Igångsättaren',     'bronze', 15, null, null, 'Få två främlingar att high-fiva varandra.', 'Dirigent framför en orkester.', false),
  (31, 'Serenaden',         'bronze', 15, null, null, 'Sjung en hel refräng högt för bordet.', 'Serenad under en balkong i månsken.', false),
  (32, 'Skönheten',         'bronze', 20, 15, 'Ni utbyter sociala medier', 'Fråga någon du finner attraktiv om deras planer för kvällen.', 'Eva med äpplet i en frodig trädgård.', false),
  (33, 'Tumdueller',        'bronze', 20, null, null, 'Utmana en främling på en tumbrottning.', 'Två sammanflätade armar, vintage brottning.', false),
  (34, 'Karaokekungen',     'bronze', 20, null, null, 'Sjung karaoke eller en låt a cappella, stående.', 'Scen med en ensam strålkastare.', false),
  (35, 'Berättaren',        'bronze', 15, null, null, 'Fånga bordet med en 60-sekunders historia.', 'Lägereld och en öppen sagobok.', false),
  (36, 'Plankan',           'bronze', 15, null, null, 'Håll en planka i 30 sekunder.', 'Träplanka och en styrkeman i randig baddräkt.', false),
  (37, 'Talaren',           'bronze', 20, 10, 'Grannbordet skålar med', 'Håll ett 30-sekunders improviserat tal.', 'Talarstol, klassisk orator med toga.', false),
  (38, 'Imitatören',        'bronze', 20, null, null, 'Imitera en känd person tills någon gissar rätt.', 'Två teatermasker i strålkastarljus.', false),
  (39, 'Danskampen',        'bronze', 20, null, null, 'Utmana någon på en 20-sekunders dansbattle.', 'Retro discogolv med speglar.', false),
  (40, 'Frågesporten',      'bronze', 15, null, null, 'Ställ en klurig fråga till ett grannbord.', 'Stort frågetecken i ornament.', false),
  (41, 'Menymästaren',      'bronze', 15, null, null, 'Beställ något du aldrig provat från menyn.', 'Gammal handskriven meny i kalligrafi.', false),
  (42, 'Limericken',        'bronze', 20, null, null, 'Hitta på en rimmad vers om en polare.', 'Fjäderpenna och pergamentrulle.', false),
  (43, 'Skattjägaren',      'bronze', 15, null, null, 'Hitta något rött och ge det som present till en främling.', 'Öppen skattkista med glöd.', false),
  (44, 'Vadhållaren',       'bronze', 15, null, null, 'Ingå ett litet vad med en polare och lös det direkt.', 'Handslag över ett par tärningar.', false),
  (45, 'Trubaduren',        'bronze', 15, null, null, 'Vissla en hel melodi tills någon känner igen den.', 'Noter som svävar kring en liten fågel.', false),
  (46, 'Klädbytaren',       'bronze', 15, null, null, 'Byt ett klädesplagg med en polare i en timme.', 'Öppen garderob med kostymer.', false),
  (47, 'Mästerkocken',      'bronze', 20, null, null, 'Övertala någon att dela med sig av sin mat.', 'Överdådig festmåltid, holländskt stilleben.', false),
  (48, 'Kavaljeren',        'bronze', 15, null, null, 'Bjud en polare på nästa dryck.', 'Gyllene mynt och en generös gest.', false),
  (49, 'Nickedockan',       'bronze', 20, null, null, 'Få tre personer att nicka instämmande på en påhittad faktoid.', 'Vis uggla med glasögon.', false),
  (50, 'Spegeln',           'bronze', 15, null, null, 'Härma allt en polare gör i 60 sekunder.', 'Symmetrisk spegelbild, art deco.', false),

  -- 🥈 Silver (25–30 p)
  (51, 'Charmören',         'silver', 30, null, null, 'Fråga någon om deras sociala medier och faktiskt få dem.', 'Gammaldags kärleksbrev med hjärtan.', false),
  (52, 'Dirigenten',        'silver', 30, null, null, 'Få en grupp du inte känner att sjunga med i en sång.', 'Kör lett av en dirigentpinne.', false),
  (53, 'Rendezvouset',      'silver', 30, null, null, 'Få en tydlig antydan om en dejt från någon ny.', 'Fickur och två skuggor i månljus.', false),
  (54, 'Centrumet',         'silver', 25, null, null, 'Dansa solo mitt på dansgolvet i 30 sekunder.', 'Ensam dansare i en strålkastarkägla.', false),
  (55, 'Talangen',          'silver', 25, null, null, 'Visa upp en dold talang för hela lokalen.', 'Gammal cirkusaffisch.', false),
  (56, 'Diplomaten',        'silver', 25, null, null, 'Medla så att två främlingar skålar ihop.', 'Fredsduva över två sammanförda glas.', false),
  (57, 'Frieriet',          'silver', 25, null, null, 'Gå ner på knä och "fria" på skoj till en polare.', 'Glittrande ring på en sammetskudde.', false),
  (58, 'Rekordet',          'silver', 25, null, null, 'Vinn en dryckesduell mot en polare.', 'Stoppur vid ett målsnöre.', true),
  (59, 'Insamlaren',        'silver', 30, null, null, 'Samla fem olika personers "autografer" på en servett.', 'Autografbok med bläckpenna.', false),
  (60, 'Uppträdaren',       'silver', 30, null, null, 'Framför en 30-sekunders standup för bordet.', 'Mikrofon mot en tegelvägg.', false),
  (61, 'Modellen',          'silver', 25, null, null, 'Gå en catwalk rakt genom lokalen.', 'Catwalk badad i blixtljus.', false),
  (62, 'Uppviglaren',       'silver', 25, null, null, 'Starta en "hej-våg" runt bordet eller lokalen.', 'Publikvåg i en arena.', false),
  (63, 'Bjudaren',          'silver', 30, null, null, 'Bjud en främling på en dryck och skåla ihop.', 'Två glas som möts, gyllene bubblor.', false),
  (64, 'Poeten',            'silver', 30, null, null, 'Improvisera en dikt till någon du precis träffat.', 'Pergament omgivet av rosor.', false),
  (65, 'Kavalkaden',        'silver', 30, null, null, 'Få fyra personer att bilda en kort conga-rad.', 'Karnevalståg med fjädrar.', false),
  (66, 'Trollkarlen',       'silver', 25, null, null, 'Lär dig ett snabbt trick och visa en främling.', 'Cylinderhatt och svävande spelkort.', false),
  (67, 'Reportern',         'silver', 25, null, null, 'Intervjua en främling om kvällen på 30 sekunder.', 'Gammal mikrofon och en tidningsförstasida.', false),
  (68, 'Skålmästaren',      'silver', 30, null, null, 'Få hela lokalen att höja glasen samtidigt.', 'Ett hav av höjda glas.', false),
  (69, 'Vågspelet',         'silver', 30, null, null, 'Doppa fötterna i (rent) vatten eller ta en snabb kall dusch, om säkert.', 'Böljande vågor i gravyrstil.', false),
  (70, 'Handsken',          'silver', 25, null, null, 'Ge en främling en ofarlig utmaning som de klarar av.', 'Kastad handske, duell-motiv.', false),
  (71, 'Berömmaren',        'silver', 25, null, null, 'Ge fem olika personer varsin ärlig komplimang.', 'Frodig blomsterbukett.', false),
  (72, 'Festens mittpunkt', 'silver', 30, null, null, 'Få bordet att skandera ditt namn.', 'Konfettiregn över en fest.', false),

  -- 🏆 Guld (35–45 p)
  (73, 'Numret',            'gold', 40, null, null, 'Få ett telefonnummer av någon du precis träffat.', 'Gyllene telefonlur med ett hjärta.', false),
  (74, 'Frontmannen',       'gold', 40, null, null, 'Gå upp och sjung en låt i mikrofon inför lokalen.', 'Scen dränkt i strålkastarljus.', false),
  (75, 'Dansgolvskungen',   'gold', 40, null, null, 'Få minst tio personer att dansa med dig.', 'Fullpackat dansgolv i guldton.', false),
  (76, 'Folktalaren',       'gold', 35, null, null, 'Håll ett tal som ger applåder från främlingar.', 'Podium krönt av en lagerkrans.', false),
  (77, 'Dejten',            'gold', 45, null, null, 'Boka in en faktisk träff/dejt med någon ny.', 'Kalender med en ring och en ros.', false),
  (78, 'Rockstjärnan',      'gold', 45, null, null, 'Crowd-surfa eller stagedive – endast om det är säkert och tillåtet.', 'Konsertpublik med lyfta händer.', false),
  (79, 'Komikern',          'gold', 35, null, null, 'Få en helt okänd grupp att skratta högt åt ditt skämt.', 'Scen med skrattande siluetter.', false),
  (80, 'Ledaren',           'gold', 45, null, null, 'Led hela lokalen i en gemensam sång.', 'Dirigent inför en väldig folkmassa.', false),
  (81, 'Armbrytaren',       'gold', 35, null, null, 'Vinn en armbrytning mot en främling.', 'Spända muskler i en arena.', false),
  (82, 'Namninsamlaren',    'gold', 40, null, null, 'Få tio olika personer att skriva under din "petition".', 'Pergamentrulle och fjäderpenna.', false),
  (83, 'Charmträsket',      'gold', 45, null, null, 'Få tre olika personers sociala medier på en och samma kväll.', 'Nätverk av sammanlänkade hjärtan.', false),
  (84, 'Scenkuppen',        'gold', 40, null, null, 'Ta mikrofonen och tacka publiken för en påhittad utmärkelse.', 'Gyllene gala-staty.', false),
  (85, 'Festfixaren',       'gold', 35, null, null, 'Få främlingar att slå sig ner vid ert bord.', 'Långbord i festligt sken.', false),
  (86, 'Duellmästaren',     'gold', 40, null, null, 'Vinn tre olika minispel eller dueller under kvällen.', 'Korslagda medaljer och lagerkrans.', false),
  (87, 'Modegurun',         'gold', 35, null, null, 'Byt ett plagg med en främling, med samtycke.', 'Mannekäng i en elegant garderob.', false),
  (88, 'Serenadören',       'gold', 40, null, null, 'Sjung en serenad till någon du finner attraktiv.', 'Gitarr under en fullmåne.', false),
  (89, 'Rekordhållaren',    'gold', 35, null, null, 'Sätt kvällens snabbaste dryckestid i gruppen.', 'Pokal bredvid ett stoppur.', true),
  (90, 'Ambassadören',      'gold', 35, null, null, 'Få ett annat sällskap att skåla tillsammans med er.', 'Två vimplar i broderligt möte.', false),

  -- 💎 Diamant (boss, 50–60 p)
  (91, 'Bossen: Numret & Dejten', 'diamond', 50, null, null, 'Få både numret och en inbokad dejt med någon ny.', 'Diamant och ett hjärta inneslutet i is.', false),
  (92, 'Rampljuset',        'diamond', 55, null, null, 'Framför ett helt nummer (sång eller dans) på scen inför lokalen.', 'Diamantvit strålkastare över en scen.', false),
  (93, 'Kungamakaren',      'diamond', 50, null, null, 'Få hela lokalen att skandera en polares namn.', 'Krona som svävar över ett folkhav.', false),
  (94, 'Legenden',          'diamond', 55, null, null, 'Vinn kvällens dryckesduell-turnering genom att slå tre motståndare.', 'Gyllene pokal infattad med diamanter.', true),
  (95, 'Hjärtekrossaren',   'diamond', 60, null, null, 'Få tre olika personers nummer på en och samma kväll.', 'Tre hjärtan kring en gnistrande diamant.', false),
  (96, 'Showstopparen',     'diamond', 55, null, null, 'Ta över musiken/DJ-båset och få dansgolvet att explodera.', 'DJ-bås genomskuret av laserstrålar.', false),
  (97, 'Folkets talare',    'diamond', 55, null, null, 'Håll ett tal som får en hel lokal att resa sig.', 'Podium inför en stående ovation.', false),
  (98, 'Grabbarnas hjälte', 'diamond', 60, null, null, 'Slutför fem andra utmaningar under en och samma kväll.', 'Superhjältesiluett mot en diamantsköld.', false),
  (99, 'Ikonen',            'diamond', 50, null, null, 'Bli fotad tillsammans med tio olika främlingar under kvällen.', 'Väggmosaik av polaroidfoton.', false),
  (100,'Odödlig',           'diamond', 60, null, null, 'Bjud in ett helt främmande sällskap att följa med er till nästa ställe.', 'Gryning över ett gäng på väg mot nya äventyr.', false)
on conflict (id) do nothing;
