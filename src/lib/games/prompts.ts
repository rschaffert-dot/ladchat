/** Prompt-databas för spelen. Nivåer: mild (alla), kryddig/grabbig (18+).
 * Intensitet för Sanning/Konsekvens: grön/gul/röd (gul/röd kräver 18+). */

export type PromptLevel = "mild" | "kryddig" | "grabbig";
export type Intensity = "gron" | "gul" | "rod";

export const NEVER_HAVE_I_EVER: Record<PromptLevel, string[]> = {
  mild: [
    "Jag har aldrig somnat på en fest",
    "Jag har aldrig sjungit karaoke inför folk",
    "Jag har aldrig ljugit om min ålder",
    "Jag har aldrig gråtit på bio",
    "Jag har aldrig glömt en polares födelsedag",
    "Jag har aldrig låtsats vara sjuk för att slippa jobbet",
    "Jag har aldrig ätit mat som ramlat på golvet",
    "Jag har aldrig smugit in på en fest jag inte var bjuden till",
    "Jag har aldrig skickat ett meddelande till fel person",
    "Jag har aldrig stalkat ett ex på sociala medier",
    "Jag har aldrig kissat i en pool",
    "Jag har aldrig kört vilse med GPS på",
  ],
  kryddig: [
    "Jag har aldrig kysst någon i det här rummet",
    "Jag har aldrig blivit utslängd från en krog",
    "Jag har aldrig vaknat på ett ställe utan att veta var jag var",
    "Jag har aldrig raggat på någons syskon",
    "Jag har aldrig spytt i en taxi",
    "Jag har aldrig ljugit i den här leken",
    "Jag har aldrig skickat en bild jag ångrar",
    "Jag har aldrig dejtat två personer samtidigt",
    "Jag har aldrig smitit från en nota",
    "Jag har aldrig vaknat med en okänd tatuering eller skada",
  ],
  grabbig: [
    "Jag har aldrig badat naken",
    "Jag har aldrig blivit hemskickad från förfesten",
    "Jag har aldrig hånglat med två olika personer samma kväll",
    "Jag har aldrig ringt ett ex full klockan tre på natten",
    "Jag har aldrig somnat på toaletten på en klubb",
    "Jag har aldrig ljugit om vem jag var med i går",
    "Jag har aldrig tagit hem någon jag mötte samma kväll",
    "Jag har aldrig druckit direkt ur någon annans glas utan att fråga",
    "Jag har aldrig förlorat ett vad som slutade pinsamt",
    "Jag har aldrig blivit portad från ett ställe",
  ],
};

export const TRUTHS: Record<Intensity, string[]> = {
  gron: [
    "Vad är det pinsammaste du gjort på jobbet eller i skolan?",
    "Vilken är din guilty pleasure-låt?",
    "Vad är det barnsligaste du fortfarande gör?",
    "Vilken app skäms du över att ha kvar?",
    "Vad är det dummaste du googlat senaste veckan?",
    "Vilket är ditt sämsta raggningsförsök någonsin?",
    "Vad är det konstigaste du ätit?",
    "Vilken av dina vanor irriterar andra mest?",
  ],
  gul: [
    "Vem i rummet skulle du ringa först om du hamnade i finkan?",
    "Vad är det mest pinsamma som finns i din sökhistorik?",
    "Vilken är din värsta dejt någonsin — detaljer!",
    "Vad har du ljugit om för någon i det här rummet?",
    "Vilket är ditt mest överskattade drag?",
    "Vad är det värsta betyg du fått och varför?",
    "Vem i rummet har du snackat skit om senast?",
    "Vad är det billigaste du gjort för att spara pengar?",
  ],
  rod: [
    "Vad är det olagligaste du gjort?",
    "Vilket är ditt största ånger-hångel?",
    "Vad är det värsta du gjort på en fest som ingen här vet om?",
    "Vem i rummet skulle du aldrig kunna dejta och varför?",
    "Vad är din mest pinsamma fyllahistoria?",
    "Vad är det elakaste du gjort mot ett ex?",
    "Vilken hemlighet har du aldrig berättat för gruppen?",
    "Vad är det mest desperata du gjort för uppmärksamhet?",
  ],
};

export const DARES: Record<Intensity, string[]> = {
  gron: [
    "Prata med utländsk brytning tills det är din tur igen",
    "Gör 15 armhävningar nu",
    "Låt personen till vänster posta en (schysst) story på ditt konto",
    "Imitera någon i rummet tills någon gissar vem",
    "Dansa utan musik i 30 sekunder",
    "Säg alfabetet baklänges — misslyckas = straff",
    "Håll ett 30-sekunderstal om varför du är gruppens alfa",
    "Byt plats och sitt i knät på personen till höger i en runda",
  ],
  gul: [
    "Ring en polare och sjung grattis-sången (det är ingens födelsedag)",
    "Låt gruppen skriva ett meddelande från din telefon (de väljer till vem)",
    "Visa det senaste fotot i din kamerarulle",
    "Ät en sked av något gruppen blandar (ätbart!)",
    "Låt personen mittemot göra om din frisyr",
    "Tala bara i frågor tills det är din tur igen",
    "Visa din skärmtid för gruppen",
    "Härma en i rummet tills nästa runda — de får inte veta vem",
  ],
  rod: [
    "Ring ditt senaste ex eller drick dubbelt",
    "Låt gruppen läsa din senaste DM-konversation högt",
    "Ge din telefon olåst till personen till vänster i två minuter",
    "Berätta vem i rummet du hade valt att kyssa om du var tvungen",
    "Läs upp ditt senaste sökfältsförslag högt",
    "Låt gruppen välja din profilbild i en vecka",
    "Skicka '❤️' till den femte personen i din chattlista",
    "Gör din bästa strippdans i 20 sekunder (kläderna på!)",
  ],
};

export const MOST_LIKELY_TO: string[] = [
  "Vem är mest trolig att bli miljonär?",
  "Vem är mest trolig att somna först ikväll?",
  "Vem är mest trolig att hamna i slagsmål för något löjligt?",
  "Vem är mest trolig att bli känd på sociala medier?",
  "Vem är mest trolig att glömma sin egen födelsedag?",
  "Vem är mest trolig att gifta sig först?",
  "Vem är mest trolig att flytta utomlands?",
  "Vem är mest trolig att bli stoppad i tullen?",
  "Vem är mest trolig att gråta på en fest?",
  "Vem är mest trolig att svara sitt ex klockan 03?",
  "Vem är mest trolig att starta ett företag som går i konkurs?",
  "Vem är mest trolig att äta något från golvet?",
  "Vem är mest trolig att bli president?",
  "Vem är mest trolig att tappa bort sin telefon ikväll?",
  "Vem är mest trolig att skratta på en begravning?",
];

export const PARANOIA_QUESTIONS: string[] = [
  "Vem i rummet skulle klara sig sämst i en zombieapokalyps?",
  "Vem i rummet skulle du ringa för att gömma en kropp?",
  "Vem i rummet har sämst musiksmak?",
  "Vem i rummet skulle bli värst som chef?",
  "Vem i rummet ljuger mest?",
  "Vem i rummet skulle du helst byta liv med?",
  "Vem i rummet har mest pinsam sökhistorik?",
  "Vem i rummet skulle först bli lämnad på en öde ö?",
  "Vem i rummet är sämst på att hålla hemligheter?",
  "Vem i rummet skulle vinna i en dokusåpa?",
  "Vem i rummet är mest trolig att bli viral av fel anledning?",
  "Vem i rummet har värst temperament?",
];

export const BOMB_CATEGORIES: string[] = [
  "Ölmärken",
  "Fotbollsspelare",
  "Länder i Europa",
  "Saker på en förfest",
  "Snabbmatskedjor",
  "Svenska artister",
  "Bilmärken",
  "Saker i ett badrum",
  "Filmer med siffror i titeln",
  "Grönsaker",
  "Yrken som kräver uniform",
  "Saker som är gula",
  "Svordomar (var kreativ)",
  "Städer i Sverige",
  "Ursäkter för att komma sent",
];

/** Mobilroulette: djärva utmaningar (bakom opt-in + 18+). Vägran = straff. */
export const ROULETTE_DARES: string[] = [
  "Visa din senast använda emoji",
  "Visa den senaste bilden i kamerarullen",
  "Ring en slumpmässig kontakt och säg 'det är lugnt nu, jag har löst det'",
  "Läs upp ditt senaste skickade meddelande högt",
  "Visa din skärmtid",
  "Låt personen till vänster skicka en emoji till valfri kontakt",
  "Visa dina tre senaste sökningar",
  "Läs upp den äldsta anteckningen i din anteckningsapp",
];
