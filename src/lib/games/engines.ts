/** Återanvändbara spelmotorer. Alla spel körs lokalt på en telefon som
 * skickas runt — servern belönar bara närvaro via start_drinking_game. */

import type { Card, Rank } from "@/lib/kingsCup";
import { shuffledDeck } from "@/lib/kingsCup";

// ---------- Kortlek-motor ----------

export { shuffledDeck, isRedSuit } from "@/lib/kingsCup";
export type { Card, Rank, Suit } from "@/lib/kingsCup";

/** Ess högt (14) — används för högre/lägre och innanför/utanför. */
export function rankValue(rank: Rank): number {
  if (rank === "A") return 14;
  if (rank === "K") return 13;
  if (rank === "Q") return 12;
  if (rank === "J") return 11;
  return parseInt(rank, 10);
}

export function isFaceOrAce(card: Card): boolean {
  return card.rank === "J" || card.rank === "Q" || card.rank === "K" || card.rank === "A";
}

/** Drag utan återläggning: [dragen, resterande lek]. */
export function drawOne(deck: Card[]): [Card, Card[]] {
  const [card, ...rest] = deck;
  return [card, rest];
}

/** Drag med återläggning (leken påverkas inte). */
export function drawWithReplacement(deck: Card[]): Card {
  return deck[Math.floor(Math.random() * deck.length)];
}

/** Spelarhänder: kort man vunnit/samlat, per spelar-id. */
export type Hands = Record<string, Card[]>;

export function emptyHands(playerIds: string[]): Hands {
  return Object.fromEntries(playerIds.map((id) => [id, []]));
}

// ---------- Tärnings-motor ----------

export function rollDie(): number {
  return 1 + Math.floor(Math.random() * 6);
}

export function rollDice(): [number, number] {
  return [rollDie(), rollDie()];
}

/** Mexico-rang: 21 högst, sedan dubblar (66 ner till 11), sedan övriga i
 * talordning (läs högsta siffran först: 5+2 = 52). */
export function mexicoRank(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi === 2 && lo === 1) return 1000;
  if (a === b) return 100 + a;
  return hi * 10 + lo;
}

export function mexicoLabel(a: number, b: number): string {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi === 2 && lo === 1) return "21 — MEXICO!";
  return `${hi}${lo}`;
}

/** Alla 21 möjliga slag, sorterade lägst→högst (för påstå-listan vid bluff). */
export const MEXICO_VALUES: { a: number; b: number; rank: number; label: string }[] = (() => {
  const seen = new Set<number>();
  const out: { a: number; b: number; rank: number; label: string }[] = [];
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      const r = mexicoRank(a, b);
      if (!seen.has(r)) {
        seen.add(r);
        out.push({ a, b, rank: r, label: mexicoLabel(a, b) });
      }
    }
  }
  return out.sort((x, y) => x.rank - y.rank);
})();

// ---------- Prompt-motor ----------

/** Blandad iterator utan upprepningar; blandar om när allt är förbrukat. */
export function makePromptIterator<T>(items: T[]): () => T {
  let pool: T[] = [];
  return () => {
    if (pool.length === 0) {
      pool = [...items];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
    }
    return pool.pop() as T;
  };
}

// ---------- Röstnings-motor ----------

export function tallyVotes(
  votes: Record<string, string>,
): { targetId: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const target of Object.values(votes)) {
    counts[target] = (counts[target] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([targetId, count]) => ({ targetId, count }))
    .sort((x, y) => y.count - x.count);
}

// ---------- Timer-motor ----------

export function randomFuseMs(minMs = 10_000, maxMs = 60_000): number {
  return minMs + Math.floor(Math.random() * (maxMs - minMs));
}

/** Detonation: djup boom-ton + vibration där det stöds. Tyst fallback. */
export function detonate() {
  try {
    if (typeof window !== "undefined") {
      const AudioCtx =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(160, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(35, ctx.currentTime + 0.7);
        gain.gain.setValueAtTime(0.35, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.85);
      }
      const nav = navigator as { vibrate?: (ms: number | number[]) => boolean };
      nav.vibrate?.([300, 80, 300]);
    }
  } catch {
    // Ljud/haptik är krydda, inte kritiskt.
  }
}

// ---------- Slumpval-motor ----------

export function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function pickRandomIndex(length: number): number {
  return Math.floor(Math.random() * length);
}
