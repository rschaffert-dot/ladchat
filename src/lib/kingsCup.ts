/** Kings Cup: 52 kort, varje valör har en regel. Spelet körs lokalt på en
 * telefon som skickas runt — servern belönar bara närvaro (start_drinking_game). */

export type Suit = "♠" | "♥" | "♦" | "♣";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const RANK_LABELS: Record<Rank, string> = {
  A: "Ess",
  "2": "Två",
  "3": "Tre",
  "4": "Fyra",
  "5": "Fem",
  "6": "Sex",
  "7": "Sju",
  "8": "Åtta",
  "9": "Nio",
  "10": "Tio",
  J: "Knekt",
  Q: "Dam",
  K: "Kung",
};

export const KINGS_CUP_RULES: Record<Rank, { title: string; rule: string }> = {
  A: {
    title: "Vattenfall",
    rule: "Alla börjar dricka samtidigt. Ingen får sluta förrän personen före (till vänster om) en själv har slutat.",
  },
  "2": { title: "Du", rule: "Välj vem som helst vid bordet — den personen dricker." },
  "3": { title: "Jag", rule: "Du som drog kortet dricker själv." },
  "4": { title: "Golv", rule: "Sist att röra golvet dricker." },
  "5": { title: "Killar", rule: "Alla killar vid bordet dricker." },
  "6": { title: "Tjejer", rule: "Alla tjejer vid bordet dricker." },
  "7": {
    title: "Himmel",
    rule: "Sträck handen mot himlen! Alla andra måste göra likadant — sist upp dricker.",
  },
  "8": {
    title: "Polare",
    rule: "Välj en polare. Resten av spelet dricker hen varje gång du dricker.",
  },
  "9": {
    title: "Rim",
    rule: "Säg ett ord. Nästa spelare säger ett ord som rimmar, och så vidare. Den som kör fast dricker. Inga ord får återanvändas.",
  },
  "10": {
    title: "Kategorier",
    rule: "Hitta på en kategori. Nästa spelare nämner något i kategorin, och så vidare. Den som kör fast dricker.",
  },
  J: { title: "Jag har aldrig", rule: "Alla spelar en runda 'Jag har aldrig'." },
  Q: {
    title: "Frågor",
    rule: "Ställ en fråga till någon, som direkt ställer en fråga till någon annan. Den som sabbar eller inte kommer på en fråga dricker. Inga upprepade frågor.",
  },
  K: {
    title: "Kungens kopp",
    rule: "Hitta på en regel som gäller resten av spelet (t.ex. drick på ett ben). Kung 1–3: häll lite av din dryck i koppen i mitten. Kung 4: drick hela Kungens kopp!",
  },
};

const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
const RANKS: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function shuffledDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function isRedSuit(suit: Suit): boolean {
  return suit === "♥" || suit === "♦";
}
