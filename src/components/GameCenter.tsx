import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  MEXICO_VALUES,
  detonate,
  drawOne,
  emptyHands,
  isFaceOrAce,
  isRedSuit,
  makePromptIterator,
  mexicoLabel,
  mexicoRank,
  pickRandomIndex,
  randomFuseMs,
  rankValue,
  rollDice,
  shuffledDeck,
  tallyVotes,
} from "@/lib/games/engines";
import type { Card, Hands, Suit } from "@/lib/games/engines";
import {
  BOMB_CATEGORIES,
  DARES,
  MOST_LIKELY_TO,
  NEVER_HAVE_I_EVER,
  PARANOIA_QUESTIONS,
  ROULETTE_DARES,
  TRUTHS,
} from "@/lib/games/prompts";
import type { Intensity, PromptLevel } from "@/lib/games/prompts";
import { KINGS_CUP_RULES, RANK_LABELS } from "@/lib/kingsCup";
import { supabase } from "@/lib/supabase";

// ============================================================
// Delat: speldefinitioner, inställningar, hjälpare
// ============================================================

export type GameMember = { id: string; name: string };

export type GameSettings = {
  alcoholFree: boolean;
  adult: boolean;
  sips: number;
  level: PromptLevel;
  intensity: Intensity;
  nhieCompetitive: boolean;
  mexicoSimple: boolean;
  buzzExtra: number | null;
  rouletteDare: boolean;
  tjugoettClassic: boolean;
};

const DEFAULT_SETTINGS: GameSettings = {
  alcoholFree: false,
  adult: false,
  sips: 1,
  level: "mild",
  intensity: "gron",
  nhieCompetitive: false,
  mexicoSimple: false,
  buzzExtra: null,
  rouletteDare: false,
  tjugoettClassic: true,
};

type GameId =
  | "kingscup"
  | "bus"
  | "mexico"
  | "nhie"
  | "tod"
  | "mostlikely"
  | "paranoia"
  | "buzz"
  | "roulette"
  | "bomb"
  | "tjugoett";

const GAMES: { id: GameId; emoji: string; title: string; desc: string; category: "drick" | "utmaning" }[] = [
  { id: "kingscup", emoji: "👑", title: "Kings Cup", desc: "Dra kort, följ regeln, skicka vidare.", category: "drick" },
  { id: "bus", emoji: "🚌", title: "Ride the Bus", desc: "Gissa kort i tre faser — förloraren åker bussen.", category: "drick" },
  { id: "mexico", emoji: "🎲", title: "Mexico", desc: "Två tärningar under dold kopp. Bluffa eller syna.", category: "drick" },
  { id: "buzz", emoji: "🔢", title: "Buzz", desc: "Räkna i tur — men sjuor är förbjudna.", category: "drick" },
  { id: "tjugoett", emoji: "🥂", title: "21", desc: "Räkna till 21 ihop — den som säger 21 skapar en ny regel.", category: "drick" },
  { id: "bomb", emoji: "💣", title: "The Bomb", desc: "Säg ett ord i kategorin och skicka vidare — före smällen.", category: "drick" },
  { id: "roulette", emoji: "📱", title: "Mobilroulette", desc: "Snurra — ödet väljer vem som drabbas.", category: "drick" },
  { id: "nhie", emoji: "🙊", title: "Jag har aldrig", desc: "Alla som gjort det dricker.", category: "utmaning" },
  { id: "tod", emoji: "🎭", title: "Sanning eller konsekvens", desc: "Välj själv — vägra och drick.", category: "utmaning" },
  { id: "mostlikely", emoji: "🫵", title: "Vem är mest trolig", desc: "Alla röstar — flest röster dricker.", category: "utmaning" },
  { id: "paranoia", emoji: "🤫", title: "Paranoia", desc: "Hemlig fråga, högt svar. Vågar du veta?", category: "utmaning" },
];

type GameProps = {
  players: string[];
  names: Record<string, string>;
  settings: GameSettings;
  onExit: () => void;
};

function sipText(mult: number, settings: GameSettings): string {
  const n = mult * settings.sips;
  const unit = n === 1 ? "klunk" : "klunkar";
  return settings.alcoholFree ? `${n} alkoholfria ${unit}` : `${n} ${unit}`;
}

function TurnBanner({ name }: { name: string }) {
  return (
    <View style={styles.turnBanner}>
      <Text style={styles.turnLabel}>Nu är det</Text>
      <Text style={styles.turnName}>{name}s tur</Text>
    </View>
  );
}

function Btn({
  label,
  onPress,
  disabled,
  tone,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "primary" | "ghost" | "danger";
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.btn,
        tone === "ghost" ? styles.btnGhost : null,
        tone === "danger" ? styles.btnDanger : null,
        disabled ? { opacity: 0.4 } : null,
      ]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

function NameGrid({
  players,
  names,
  onPick,
  exclude,
}: {
  players: string[];
  names: Record<string, string>;
  onPick: (id: string) => void;
  exclude?: string[];
}) {
  return (
    <View style={styles.nameGrid}>
      {players
        .filter((p) => !exclude?.includes(p))
        .map((p) => (
          <Pressable key={p} onPress={() => onPick(p)} style={styles.nameChip}>
            <Text style={styles.nameChipText}>{names[p] ?? "?"}</Text>
          </Pressable>
        ))}
    </View>
  );
}

function ResultMsg({ text, good }: { text: string; good?: boolean }) {
  return (
    <View style={[styles.resultBox, good ? styles.resultGood : styles.resultBad]}>
      <Text style={styles.resultText}>{text}</Text>
    </View>
  );
}

function PlayingCardView({ card, small }: { card: Card; small?: boolean }) {
  const color = isRedSuit(card.suit) ? "#FF4C29" : "#111";
  return (
    <View style={[styles.pCard, small ? styles.pCardSmall : null]}>
      <Text style={[small ? styles.pCardTextSmall : styles.pCardText, { color }]}>
        {card.rank}
        {card.suit}
      </Text>
    </View>
  );
}

// ============================================================
// Spel 1: Kings Cup (flyttad oförändrad från chattvyn)
// ============================================================

function KingsCupGame({ players, names, onExit }: GameProps) {
  const [deck, setDeck] = useState<Card[]>(() => shuffledDeck());
  const [card, setCard] = useState<Card | null>(null);
  const [kings, setKings] = useState(0);
  const [turn, setTurn] = useState(0);
  const [endReason, setEndReason] = useState<string | null>(null);
  const lockRef = useRef(false);

  function draw() {
    if (lockRef.current || card || deck.length === 0) return;
    lockRef.current = true;
    const [c, rest] = drawOne(deck);
    setDeck(rest);
    setCard(c);
    if (c.rank === "K") setKings((k) => k + 1);
  }

  function next() {
    if (!card || !lockRef.current) return;
    lockRef.current = false;
    if (card.rank === "K" && kings >= 4) {
      setEndReason("👑 Fjärde kungen drogs — Kungens kopp har druckits!");
      return;
    }
    if (deck.length === 0) {
      setEndReason("🃏 Leken är slut — bra kämpat, grabbar!");
      return;
    }
    setCard(null);
    setTurn((t) => (t + 1) % players.length);
  }

  if (endReason) {
    return (
      <View style={[styles.gameBody, { alignItems: "center", gap: 16 }]}>
        <Text style={{ fontSize: 56 }}>🏁</Text>
        <Text style={styles.h1}>Spelet är slut!</Text>
        <Text style={styles.dim}>{endReason}</Text>
        <Btn label="Tillbaka" onPress={onExit} />
      </View>
    );
  }

  return (
    <View style={styles.gameBody}>
      <TurnBanner name={names[players[turn]] ?? "?"} />
      <Pressable onPress={draw} style={{ alignItems: "center" }}>
        {card ? (
          <View style={styles.bigCard}>
            <Text style={[styles.bigCardCorner, { color: isRedSuit(card.suit) ? "#FF4C29" : "#111" }]}>
              {card.rank}
              {card.suit}
            </Text>
            <Text style={[styles.bigCardSuit, { color: isRedSuit(card.suit) ? "#FF4C29" : "#111" }]}>
              {card.suit}
            </Text>
          </View>
        ) : (
          <View style={styles.cardBack}>
            <Text style={{ fontSize: 44 }}>🂠</Text>
            <Text style={styles.cardBackText}>Tryck för att dra ett kort</Text>
          </View>
        )}
      </Pressable>
      {card ? (
        <View style={styles.ruleBox}>
          <Text style={styles.ruleTitle}>
            {RANK_LABELS[card.rank]} — {KINGS_CUP_RULES[card.rank].title}
            {card.rank === "K" ? ` (${kings}/4)` : ""}
          </Text>
          <Text style={styles.ruleText}>
            {card.rank === "K" && kings >= 4
              ? "FJÄRDE KUNGEN! Drick hela Kungens kopp! 🍻"
              : KINGS_CUP_RULES[card.rank].rule}
          </Text>
        </View>
      ) : null}
      <View style={styles.statusRow}>
        <Text style={styles.dim}>🃏 {deck.length} kort kvar</Text>
        <Text style={styles.dim}>👑 {kings}/4 kungar</Text>
      </View>
      {card ? (
        <Btn
          label={
            (card.rank === "K" && kings >= 4) || deck.length === 0
              ? "Avsluta spelet"
              : `Nästa: ${names[players[(turn + 1) % players.length]] ?? "?"} →`
          }
          onPress={next}
        />
      ) : null}
    </View>
  );
}

// ============================================================
// Spel 2: Ride the Bus
// ============================================================

const F1_REWARD = [1, 2, 3, 4];

function RideTheBusGame({ players, names, settings, onExit }: GameProps) {
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [deck, setDeck] = useState<Card[]>(() => shuffledDeck());
  const [hands, setHands] = useState<Hands>(() => emptyHands(players));
  const [pIdx, setPIdx] = useState(0);
  const [step, setStep] = useState(0);
  const [msg, setMsg] = useState<{ text: string; good: boolean } | null>(null);
  // Pyramiden: rad 4 (botten, 1 klunk) vänds först, sedan uppåt mot rad 1...
  // radnumret = antal klunkar: rad index 0..3 med storlek 4,3,2,1 → klunkar 1..4.
  const [pyramid, setPyramid] = useState<{ card: Card; row: number; flipped: boolean }[]>([]);
  const [pyrIdx, setPyrIdx] = useState(0);
  const [busRider, setBusRider] = useState<string | null>(null);
  const [busCards, setBusCards] = useState<Card[]>([]);
  const [busIdx, setBusIdx] = useState(0);
  const [busDone, setBusDone] = useState(false);

  const myHand = hands[players[pIdx]] ?? [];

  function evaluate(stepIdx: number, choice: string) {
    const [card, rest] = drawOne(deck);
    setDeck(rest);
    const hand = hands[players[pIdx]] ?? [];
    let correct = false;
    if (stepIdx === 0) {
      correct = (choice === "rod") === isRedSuit(card.suit);
    } else if (stepIdx === 1) {
      const prev = rankValue(hand[0].rank);
      const v = rankValue(card.rank);
      correct = v !== prev && (choice === "hogre" ? v > prev : v < prev);
    } else if (stepIdx === 2) {
      const a = rankValue(hand[0].rank);
      const b = rankValue(hand[1].rank);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const v = rankValue(card.rank);
      const inside = v > lo && v < hi;
      const outside = v < lo || v > hi;
      correct = choice === "innanfor" ? inside : outside;
    } else {
      correct = choice === card.suit;
    }
    setHands((prev) => ({ ...prev, [players[pIdx]]: [...(prev[players[pIdx]] ?? []), card] }));
    const reward = F1_REWARD[stepIdx];
    setMsg(
      correct
        ? { text: `Rätt! ${card.rank}${card.suit} — dela ut ${sipText(reward, settings)}.`, good: true }
        : { text: `Fel! ${card.rank}${card.suit} — drick ${sipText(reward, settings)} själv.`, good: false },
    );
  }

  function nextF1() {
    setMsg(null);
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    if (pIdx < players.length - 1) {
      setPIdx(pIdx + 1);
      setStep(0);
      return;
    }
    // Fas 2: bygg pyramiden 4-3-2-1 ur resterande lek.
    let d = deck;
    const rows = [4, 3, 2, 1];
    const cards: { card: Card; row: number; flipped: boolean }[] = [];
    rows.forEach((size, i) => {
      for (let k = 0; k < size; k++) {
        const [c, rest] = drawOne(d);
        d = rest;
        cards.push({ card: c, row: i + 1, flipped: false });
      }
    });
    setDeck(d);
    setPyramid(cards);
    setStage(2);
  }

  function flipPyramid() {
    setMsg(null);
    setPyramid((prev) => prev.map((p, i) => (i === pyrIdx ? { ...p, flipped: true } : p)));
  }

  function claim(pid: string) {
    const current = pyramid[pyrIdx];
    if (!current?.flipped) return;
    const hand = hands[pid] ?? [];
    const has = hand.findIndex((c) => c.rank === current.card.rank);
    if (has >= 0) {
      setHands((prev) => ({ ...prev, [pid]: prev[pid].filter((_, i) => i !== has) }));
      setMsg({
        text: `✓ ${names[pid]} lägger ${current.card.rank} — delar ut ${sipText(current.row, settings)}!`,
        good: true,
      });
    } else {
      setMsg({
        text: `🤥 ${names[pid]} har ingen ${RANK_LABELS[current.card.rank].toLowerCase()}! Synad bluff = drick dubbelt (${sipText(current.row * 2, settings)}).`,
        good: false,
      });
    }
  }

  function nextPyramid() {
    setMsg(null);
    if (pyrIdx < pyramid.length - 1) {
      setPyrIdx(pyrIdx + 1);
      return;
    }
    // Fas 3: flest kort på hand åker bussen.
    let rider = players[0];
    for (const p of players) {
      if ((hands[p]?.length ?? 0) > (hands[rider]?.length ?? 0)) rider = p;
    }
    setBusRider(rider);
    setBusCards(shuffledDeck().slice(0, 6));
    setBusIdx(0);
    setStage(3);
  }

  function flipBus() {
    const card = busCards[busIdx];
    if (isFaceOrAce(card)) {
      setMsg({
        text: `${card.rank}${card.suit} — klätt kort! Drick ${sipText(1, settings)}. Raden börjar om.`,
        good: false,
      });
      setBusCards(shuffledDeck().slice(0, 6));
      setBusIdx(0);
      return;
    }
    setMsg({ text: `${card.rank}${card.suit} — säkert! Vidare.`, good: true });
    if (busIdx === 5) {
      setBusDone(true);
    } else {
      setBusIdx(busIdx + 1);
    }
  }

  if (stage === 1) {
    const stepUI = [
      { q: "Rött eller svart?", buttons: [["rod", "🔴 Rött"], ["svart", "⚫ Svart"]] },
      { q: `Högre eller lägre än ${myHand[0]?.rank ?? "?"}${myHand[0]?.suit ?? ""}? (lika = fel)`, buttons: [["hogre", "⬆️ Högre"], ["lagre", "⬇️ Lägre"]] },
      {
        q: `Innanför eller utanför ${myHand[0]?.rank ?? "?"} och ${myHand[1]?.rank ?? "?"}?`,
        buttons: [["innanfor", "↔️ Innanför"], ["utanfor", "↕️ Utanför"]],
      },
      { q: "Vilken svit?", buttons: [["♠", "♠"], ["♥", "♥"], ["♦", "♦"], ["♣", "♣"]] },
    ][step];
    return (
      <View style={styles.gameBody}>
        <Text style={styles.phaseLabel}>Fas 1 — gissa korten · steg {step + 1}/4</Text>
        <TurnBanner name={names[players[pIdx]] ?? "?"} />
        <View style={styles.handRow}>
          {myHand.map((c, i) => (
            <PlayingCardView key={i} card={c} small />
          ))}
        </View>
        {msg ? (
          <>
            <ResultMsg text={msg.text} good={msg.good} />
            <Btn label="Vidare →" onPress={nextF1} />
          </>
        ) : (
          <>
            <Text style={styles.h2}>{stepUI.q}</Text>
            <View style={styles.btnRow}>
              {stepUI.buttons.map(([key, label]) => (
                <Pressable key={key} onPress={() => evaluate(step, key)} style={styles.choiceBtn}>
                  <Text style={styles.btnText}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </View>
    );
  }

  if (stage === 2) {
    const current = pyramid[pyrIdx];
    return (
      <View style={styles.gameBody}>
        <Text style={styles.phaseLabel}>Fas 2 — pyramiden (rad = antal klunkar att dela ut)</Text>
        <View style={styles.pyramid}>
          {[4, 3, 2, 1].map((row) => (
            <View key={row} style={styles.pyramidRow}>
              {pyramid
                .filter((p) => p.row === row)
                .map((p, i) =>
                  p.flipped ? (
                    <PlayingCardView key={i} card={p.card} small />
                  ) : (
                    <View key={i} style={styles.pCardBack} />
                  ),
                )}
            </View>
          ))}
        </View>
        {current?.flipped ? (
          <>
            <Text style={styles.h2}>
              {RANK_LABELS[current.card.rank]} (rad {current.row} = {sipText(current.row, settings)})
            </Text>
            <Text style={styles.dim}>Vem lägger? (bluff tillåten — tryck på namnet)</Text>
            <NameGrid players={players} names={names} onPick={claim} />
            {msg ? <ResultMsg text={msg.text} good={msg.good} /> : null}
            <Btn label={pyrIdx < pyramid.length - 1 ? "Nästa kort →" : "Till bussen →"} onPress={nextPyramid} />
          </>
        ) : (
          <Btn label="Vänd nästa kort" onPress={flipPyramid} />
        )}
      </View>
    );
  }

  return (
    <View style={styles.gameBody}>
      <Text style={styles.phaseLabel}>Fas 3 — bussen 🚌</Text>
      <Text style={styles.h1}>{names[busRider ?? ""] ?? "?"} åker bussen!</Text>
      <Text style={styles.dim}>
        Sex kort i rad. Klätt kort (kn/dam/kung/ess) = drick och börja om. Klara hela raden för att
        kliva av.
      </Text>
      <View style={styles.handRow}>
        {busCards.map((c, i) => (
          <View key={i}>
            {i < busIdx || busDone ? <PlayingCardView card={c} small /> : <View style={styles.pCardBack} />}
          </View>
        ))}
      </View>
      {msg ? <ResultMsg text={msg.text} good={msg.good} /> : null}
      {busDone ? (
        <>
          <Text style={styles.h1}>🎉 Bussen är klarad!</Text>
          <Btn label="Tillbaka" onPress={onExit} />
        </>
      ) : (
        <Btn label={`Vänd kort ${busIdx + 1}/6`} onPress={flipBus} />
      )}
    </View>
  );
}

// ============================================================
// Spel 3: Mexico
// ============================================================

function MexicoGame({ players, names, settings, onExit }: GameProps) {
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<"roll" | "claim" | "respond" | "result">("roll");
  const [actual, setActual] = useState<[number, number] | null>(null);
  const [claimRank, setClaimRank] = useState<number | null>(null);
  const [prevRank, setPrevRank] = useState<number | null>(null);
  const [prevClaimer, setPrevClaimer] = useState<number | null>(null);
  const [peek, setPeek] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Enkelt läge: alla slår öppet, lägst dricker.
  const [openRolls, setOpenRolls] = useState<Record<string, [number, number]>>({});

  const current = players[idx];

  if (settings.mexicoSimple) {
    const allRolled = players.every((p) => openRolls[p]);
    let loser: string | null = null;
    let anyMexico = false;
    if (allRolled) {
      loser = players[0];
      for (const p of players) {
        const [a, b] = openRolls[p];
        if (mexicoRank(a, b) === 1000) anyMexico = true;
        const [la, lb] = openRolls[loser];
        if (mexicoRank(a, b) < mexicoRank(la, lb)) loser = p;
      }
    }
    return (
      <View style={styles.gameBody}>
        <Text style={styles.phaseLabel}>Mexico — enkelt läge (öppna slag, lägst dricker)</Text>
        {!allRolled ? (
          <>
            <TurnBanner name={names[players[players.findIndex((p) => !openRolls[p])]] ?? "?"} />
            <Btn
              label="🎲 Slå tärningarna"
              onPress={() => {
                const p = players.find((x) => !openRolls[x]);
                if (p) setOpenRolls((prev) => ({ ...prev, [p]: rollDice() }));
              }}
            />
          </>
        ) : null}
        {players
          .filter((p) => openRolls[p])
          .map((p) => (
            <Text key={p} style={styles.h2}>
              {names[p]}: 🎲 {mexicoLabel(...openRolls[p])}
            </Text>
          ))}
        {allRolled && loser ? (
          <>
            <ResultMsg
              text={`${names[loser]} slog lägst och dricker ${sipText(anyMexico ? 2 : 1, settings)}${anyMexico ? " (Mexico = dubbelt!)" : ""}.`}
              good={false}
            />
            <Btn label="Ny runda" onPress={() => setOpenRolls({})} />
            <Btn label="Avsluta" tone="ghost" onPress={onExit} />
          </>
        ) : null}
      </View>
    );
  }

  const claimable = MEXICO_VALUES.filter((v) => prevRank === null || v.rank >= prevRank);

  function settleRound(loserIdx: number, mexico: boolean, text: string) {
    setMsg(`${text} ${names[players[loserIdx]]} dricker ${sipText(mexico ? 2 : 1, settings)}${mexico ? " (Mexico = dubbelt!)" : ""}.`);
    setPhase("result");
    setIdx(loserIdx);
  }

  return (
    <View style={styles.gameBody}>
      <Text style={styles.phaseLabel}>Mexico — dold kopp, bluff tillåten</Text>
      {phase === "roll" ? (
        <>
          <TurnBanner name={names[current] ?? "?"} />
          {prevRank !== null ? (
            <Text style={styles.dim}>
              Du måste påstå minst {MEXICO_VALUES.find((v) => v.rank === prevRank)?.label} — eller bluffa.
            </Text>
          ) : null}
          <Btn
            label="🎲 Slå under koppen (dolt)"
            onPress={() => {
              setActual(rollDice());
              setPhase("claim");
            }}
          />
        </>
      ) : null}

      {phase === "claim" && actual ? (
        <>
          <TurnBanner name={names[current] ?? "?"} />
          <Pressable onPressIn={() => setPeek(true)} onPressOut={() => setPeek(false)} style={styles.peekBox}>
            <Text style={styles.h1}>{peek ? `🎲 ${mexicoLabel(...actual)}` : "👁 Håll in för att smygtitta"}</Text>
          </Pressable>
          <Text style={styles.h2}>Vad påstår du att du slog?</Text>
          <ScrollView style={{ maxHeight: 180 }}>
            <View style={styles.nameGrid}>
              {[...claimable].reverse().map((v) => (
                <Pressable
                  key={v.rank}
                  onPress={() => {
                    setClaimRank(v.rank);
                    setPhase("respond");
                    setIdx((idx + 1) % players.length);
                    setPrevClaimer(idx);
                  }}
                  style={styles.nameChip}
                >
                  <Text style={styles.nameChipText}>{v.label}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </>
      ) : null}

      {phase === "respond" && claimRank !== null && prevClaimer !== null ? (
        <>
          <TurnBanner name={names[current] ?? "?"} />
          <Text style={styles.h2}>
            {names[players[prevClaimer]]} påstår{" "}
            {MEXICO_VALUES.find((v) => v.rank === claimRank)?.label}
          </Text>
          <Btn
            label="🎲 Tro — slå vidare"
            onPress={() => {
              setPrevRank(claimRank);
              setActual(null);
              setClaimRank(null);
              setPhase("roll");
            }}
          />
          <Btn
            label="👊 SYNA!"
            tone="danger"
            onPress={() => {
              if (!actual) return;
              const real = mexicoRank(...actual);
              const truthful = real >= claimRank;
              const mexico = real === 1000 || claimRank === 1000;
              if (truthful) {
                settleRound(idx, mexico, `Slaget var 🎲 ${mexicoLabel(...actual)} — sant påstående! Synaren förlorar.`);
              } else {
                settleRound(prevClaimer, mexico, `Slaget var 🎲 ${mexicoLabel(...actual)} — BLUFF avslöjad!`);
              }
            }}
          />
        </>
      ) : null}

      {phase === "result" && msg ? (
        <>
          <ResultMsg text={msg} good={false} />
          <Btn
            label="Ny runda"
            onPress={() => {
              setActual(null);
              setClaimRank(null);
              setPrevRank(null);
              setPrevClaimer(null);
              setMsg(null);
              setPhase("roll");
            }}
          />
          <Btn label="Avsluta" tone="ghost" onPress={onExit} />
        </>
      ) : null}
    </View>
  );
}

// ============================================================
// Spel 4: Never Have I Ever
// ============================================================

function NeverEverGame({ players, names, settings, onExit }: GameProps) {
  const nextPrompt = useMemo(
    () => makePromptIterator(NEVER_HAVE_I_EVER[settings.adult ? settings.level : "mild"]),
    [settings.adult, settings.level],
  );
  const [statement, setStatement] = useState(() => nextPrompt());
  const [reader, setReader] = useState(0);
  const [lives, setLives] = useState<Record<string, number>>(() =>
    Object.fromEntries(players.map((p) => [p, 3])),
  );

  const out = players.filter((p) => lives[p] <= 0);

  return (
    <View style={styles.gameBody}>
      <Text style={styles.phaseLabel}>
        Jag har aldrig{settings.nhieCompetitive ? " — tävlingsläge (3 liv)" : ""}
      </Text>
      <TurnBanner name={`${names[players[reader]] ?? "?"} läser — alla svarar samtidigt. Det är ${names[players[reader]] ?? "?"}`} />
      <View style={styles.promptCard}>
        <Text style={styles.promptText}>{statement}</Text>
      </View>
      <Text style={styles.dim}>Alla som gjort det dricker {sipText(1, settings)} 🍺</Text>
      {settings.nhieCompetitive ? (
        <>
          <Text style={styles.dim}>Tryck på den som drack (−1 liv):</Text>
          <View style={styles.nameGrid}>
            {players.map((p) => (
              <Pressable
                key={p}
                onPress={() => setLives((prev) => ({ ...prev, [p]: Math.max(0, prev[p] - 1) }))}
                style={[styles.nameChip, lives[p] <= 0 ? { opacity: 0.4 } : null]}
              >
                <Text style={styles.nameChipText}>
                  {names[p]} {"❤️".repeat(lives[p])}
                </Text>
              </Pressable>
            ))}
          </View>
          {out.length > 0 ? (
            <ResultMsg
              text={`${out.map((p) => names[p]).join(", ")} är utslagen — rundans förlorare dricker ${sipText(2, settings)}!`}
              good={false}
            />
          ) : null}
        </>
      ) : null}
      <Btn
        label="Nästa påstående →"
        onPress={() => {
          setStatement(nextPrompt());
          setReader((r) => (r + 1) % players.length);
        }}
      />
      <Btn label="Avsluta" tone="ghost" onPress={onExit} />
    </View>
  );
}

// ============================================================
// Spel 5: Truth or Dare
// ============================================================

function TruthDareGame({ players, names, settings, onExit }: GameProps) {
  const intensity = settings.adult ? settings.intensity : "gron";
  const nextTruth = useMemo(() => makePromptIterator(TRUTHS[intensity]), [intensity]);
  const nextDare = useMemo(() => makePromptIterator(DARES[intensity]), [intensity]);
  const [turn, setTurn] = useState(0);
  const [choice, setChoice] = useState<"t" | "d" | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function advance() {
    setChoice(null);
    setPrompt(null);
    setMsg(null);
    setTurn((t) => (t + 1) % players.length);
  }

  return (
    <View style={styles.gameBody}>
      <Text style={styles.phaseLabel}>
        Sanning eller konsekvens — nivå {intensity === "gron" ? "🟢 grön" : intensity === "gul" ? "🟡 gul" : "🔴 röd"}
      </Text>
      <TurnBanner name={names[players[turn]] ?? "?"} />
      {!choice ? (
        <View style={styles.btnRow}>
          <Pressable
            onPress={() => {
              setChoice("t");
              setPrompt(nextTruth());
            }}
            style={styles.choiceBtn}
          >
            <Text style={styles.btnText}>🗣 Sanning</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setChoice("d");
              setPrompt(nextDare());
            }}
            style={styles.choiceBtn}
          >
            <Text style={styles.btnText}>🔥 Konsekvens</Text>
          </Pressable>
        </View>
      ) : null}
      {prompt ? (
        <View style={styles.promptCard}>
          <Text style={styles.promptText}>{prompt}</Text>
        </View>
      ) : null}
      {msg ? <ResultMsg text={msg} good={false} /> : null}
      {prompt && !msg ? (
        <>
          <Text style={styles.dim}>Gruppen avgör:</Text>
          <Btn label="✓ Klarade det" onPress={advance} />
          <Btn
            label="✗ Klarade inte / vägrade"
            tone="danger"
            onPress={() =>
              setMsg(
                `${names[players[turn]]} dricker ${sipText(choice === "t" ? 1 : 2, settings)}!`,
              )
            }
          />
        </>
      ) : null}
      {msg ? <Btn label="Nästa spelare →" onPress={advance} /> : null}
      <Btn label="Avsluta" tone="ghost" onPress={onExit} />
    </View>
  );
}

// ============================================================
// Spel 6: Most Likely To
// ============================================================

function MostLikelyGame({ players, names, settings, onExit }: GameProps) {
  const nextQ = useMemo(() => makePromptIterator(MOST_LIKELY_TO), []);
  const [q, setQ] = useState(() => nextQ());
  const [voteIdx, setVoteIdx] = useState(0);
  const [votes, setVotes] = useState<Record<string, string>>({});

  const done = voteIdx >= players.length;
  const tally = done ? tallyVotes(votes) : [];
  const top = tally[0];

  function reset() {
    setQ(nextQ());
    setVoteIdx(0);
    setVotes({});
  }

  return (
    <View style={styles.gameBody}>
      <Text style={styles.phaseLabel}>Vem är mest trolig</Text>
      <View style={styles.promptCard}>
        <Text style={styles.promptText}>{q}</Text>
      </View>
      {!done ? (
        <>
          <TurnBanner name={`${names[players[voteIdx]] ?? "?"} röstar — det är ${names[players[voteIdx]] ?? "?"}`} />
          <NameGrid
            players={players}
            names={names}
            onPick={(target) => {
              setVotes((prev) => ({ ...prev, [players[voteIdx]]: target }));
              setVoteIdx((i) => i + 1);
            }}
          />
        </>
      ) : (
        <>
          {tally.map((t) => (
            <Text key={t.targetId} style={styles.h2}>
              {names[t.targetId]}: {t.count} röst{t.count > 1 ? "er" : ""}
            </Text>
          ))}
          {top ? (
            <ResultMsg
              text={`${names[top.targetId]} fick flest röster och dricker ${sipText(top.count, settings)} (1 per röst)!`}
              good={false}
            />
          ) : null}
          <Btn label="Nästa fråga →" onPress={reset} />
          <Btn label="Avsluta" tone="ghost" onPress={onExit} />
        </>
      )}
    </View>
  );
}

// ============================================================
// Spel 7: Paranoia
// ============================================================

function ParanoiaGame({ players, names, settings, onExit }: GameProps) {
  const nextQ = useMemo(() => makePromptIterator(PARANOIA_QUESTIONS), []);
  const [turn, setTurn] = useState(0);
  const [q, setQ] = useState(() => nextQ());
  const [stage, setStage] = useState<"private" | "decide" | "revealed">("private");
  const [peek, setPeek] = useState(false);
  const [target, setTarget] = useState<string | null>(null);

  function advance() {
    setQ(nextQ());
    setStage("private");
    setTarget(null);
    setTurn((t) => (t + 1) % players.length);
  }

  return (
    <View style={styles.gameBody}>
      <Text style={styles.phaseLabel}>Paranoia — hemlig fråga, högt svar</Text>
      {stage === "private" ? (
        <>
          <TurnBanner name={names[players[turn]] ?? "?"} />
          <Text style={styles.dim}>
            Bara {names[players[turn]]} får titta! Håll in för frågan, säg sedan ett namn HÖGT och
            tryck på det.
          </Text>
          <Pressable onPressIn={() => setPeek(true)} onPressOut={() => setPeek(false)} style={styles.peekBox}>
            <Text style={styles.promptText}>{peek ? q : "👁 Håll in för din hemliga fråga"}</Text>
          </Pressable>
          <NameGrid
            players={players}
            names={names}
            exclude={[players[turn]]}
            onPick={(t) => {
              setTarget(t);
              setStage("decide");
            }}
          />
        </>
      ) : null}
      {stage === "decide" && target ? (
        <>
          <Text style={styles.h1}>{names[target]} pekades ut! 👉</Text>
          <Text style={styles.dim}>
            {names[target]} väljer: drick för att slippa veta frågan, eller avstå så avslöjas den för
            alla.
          </Text>
          <Btn label={`🍺 Jag dricker ${sipText(1, settings)} — säg inget`} onPress={advance} />
          <Btn label="😱 Avslöja frågan!" tone="danger" onPress={() => setStage("revealed")} />
        </>
      ) : null}
      {stage === "revealed" ? (
        <>
          <View style={styles.promptCard}>
            <Text style={styles.promptText}>Frågan var: {q}</Text>
          </View>
          <ResultMsg text={`…och svaret var ${names[target ?? ""] ?? "?"}. 😬`} good={false} />
          <Btn label="Nästa spelare →" onPress={advance} />
        </>
      ) : null}
      <Btn label="Avsluta" tone="ghost" onPress={onExit} />
    </View>
  );
}

// ============================================================
// Spel 8: Buzz
// ============================================================

const BUZZ_TIME_MS = 6000;

function BuzzGame({ players, names, settings, onExit }: GameProps) {
  const [n, setN] = useState(1);
  const [turn, setTurn] = useState(0);
  const [running, setRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(BUZZ_TIME_MS);
  const [msg, setMsg] = useState<string | null>(null);

  const isBuzz = useCallback(
    (num: number) => {
      const extra = settings.buzzExtra;
      if (String(num).includes("7") || num % 7 === 0) return true;
      if (extra && (String(num).includes(String(extra)) || num % extra === 0)) return true;
      return false;
    },
    [settings.buzzExtra],
  );

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const id = setInterval(() => {
      const left = BUZZ_TIME_MS - (Date.now() - started);
      setTimeLeft(Math.max(0, left));
      if (left <= 0) {
        clearInterval(id);
        fail("⏰ Tiden gick ut!");
      }
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, n, turn]);

  function fail(reason: string) {
    setMsg(`${reason} ${names[players[turn]]} dricker ${sipText(1, settings)} — vi börjar om från 1.`);
    setRunning(false);
    setN(1);
    setTurn((t) => (t + 1) % players.length);
  }

  function answer(saidBuzz: boolean) {
    if (!running) return;
    if (saidBuzz === isBuzz(n)) {
      setN(n + 1);
      setTurn((t) => (t + 1) % players.length);
      setTimeLeft(BUZZ_TIME_MS);
    } else {
      fail(saidBuzz ? `${n} är inget buzz-tal!` : `${n} är ett buzz-tal!`);
    }
  }

  return (
    <View style={styles.gameBody}>
      <Text style={styles.phaseLabel}>
        Buzz — sjuor{settings.buzzExtra ? ` och ${settings.buzzExtra}:or` : ""} är förbjudna
      </Text>
      <TurnBanner name={names[players[turn]] ?? "?"} />
      {msg ? <ResultMsg text={msg} good={false} /> : null}
      {running ? (
        <>
          <Text style={styles.buzzNumber}>{n}</Text>
          <View style={styles.timerTrack}>
            <View style={[styles.timerFill, { width: `${(timeLeft / BUZZ_TIME_MS) * 100}%` }]} />
          </View>
          <View style={styles.btnRow}>
            <Pressable onPress={() => answer(false)} style={styles.choiceBtn}>
              <Text style={styles.btnText}>{n}</Text>
            </Pressable>
            <Pressable onPress={() => answer(true)} style={[styles.choiceBtn, styles.btnDanger]}>
              <Text style={styles.btnText}>BUZZ!</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <Btn
          label={n === 1 && !msg ? "Starta räkningen" : "Fortsätt (från 1)"}
          onPress={() => {
            setMsg(null);
            setTimeLeft(BUZZ_TIME_MS);
            setRunning(true);
          }}
        />
      )}
      <Btn label="Avsluta" tone="ghost" onPress={onExit} />
    </View>
  );
}

// ============================================================
// Spel 9: Cell Phone Roulette
// ============================================================

function RouletteGame({ players, names, settings, onExit }: GameProps) {
  const [highlight, setHighlight] = useState<number | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<{ player: string; dare: string | null } | null>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timeoutsRef.current.forEach(clearTimeout), []);

  function spin() {
    if (spinning) return;
    setSpinning(true);
    setResult(null);
    const finalIdx = pickRandomIndex(players.length);
    const steps = 18 + finalIdx + players.length;
    let delay = 0;
    for (let s = 0; s <= steps; s++) {
      delay += 60 + s * 14;
      const idx = s % players.length;
      const t = setTimeout(() => {
        setHighlight(idx);
        if (s === steps) {
          setSpinning(false);
          const dareMode = settings.rouletteDare && settings.adult;
          setResult({
            player: players[idx],
            dare: dareMode ? ROULETTE_DARES[pickRandomIndex(ROULETTE_DARES.length)] : null,
          });
        }
      }, delay);
      timeoutsRef.current.push(t);
    }
  }

  return (
    <View style={styles.gameBody}>
      <Text style={styles.phaseLabel}>
        Mobilroulette{settings.rouletteDare && settings.adult ? " — djärvt läge 😈" : ""}
      </Text>
      <View style={styles.nameGrid}>
        {players.map((p, i) => (
          <View key={p} style={[styles.nameChip, highlight === i ? styles.nameChipHot : null]}>
            <Text style={styles.nameChipText}>{names[p]}</Text>
          </View>
        ))}
      </View>
      {result ? (
        <>
          <Text style={styles.h1}>🎯 {names[result.player]}!</Text>
          {result.dare ? (
            <View style={styles.promptCard}>
              <Text style={styles.promptText}>{result.dare}</Text>
            </View>
          ) : null}
          <ResultMsg
            text={
              result.dare
                ? `Utför utmaningen — eller drick ${sipText(2, settings)}!`
                : `${names[result.player]} dricker ${sipText(1, settings)}!`
            }
            good={false}
          />
        </>
      ) : null}
      <Btn label={spinning ? "Snurrar…" : "🎰 Snurra"} onPress={spin} disabled={spinning} />
      <Btn label="Avsluta" tone="ghost" onPress={onExit} />
    </View>
  );
}

// ============================================================
// Spel 10: The Bomb
// ============================================================

function BombGame({ players, names, settings, onExit }: GameProps) {
  const nextCat = useMemo(() => makePromptIterator(BOMB_CATEGORIES), []);
  const [category, setCategory] = useState(() => nextCat());
  const [holder, setHolder] = useState(0);
  const [state, setState] = useState<"idle" | "ticking" | "boom">("idle");
  const boomHolderRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holderRef = useRef(holder);
  holderRef.current = holder;

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  function start() {
    setState("ticking");
    timeoutRef.current = setTimeout(() => {
      boomHolderRef.current = holderRef.current;
      detonate();
      setState("boom");
    }, randomFuseMs(10_000, 60_000));
  }

  function newRound() {
    setCategory(nextCat());
    setHolder((boomHolderRef.current + 1) % players.length);
    setState("idle");
  }

  return (
    <View style={styles.gameBody}>
      <Text style={styles.phaseLabel}>The Bomb 💣 — säg ett ord i kategorin, skicka vidare</Text>
      <View style={styles.promptCard}>
        <Text style={styles.promptText}>Kategori: {category}</Text>
      </View>
      {state === "idle" ? (
        <>
          <TurnBanner name={names[players[holder]] ?? "?"} />
          <Text style={styles.dim}>Bomben är gillrad på 10–60 sekunder — ingen vet när den smäller.</Text>
          <Btn label="💣 Tänd stubinen" onPress={start} />
        </>
      ) : null}
      {state === "ticking" ? (
        <>
          <TurnBanner name={names[players[holder]] ?? "?"} />
          <Text style={{ fontSize: 64, textAlign: "center" }}>💣</Text>
          <Btn
            label="Sagt mitt ord — SKICKA VIDARE →"
            onPress={() => setHolder((h) => (h + 1) % players.length)}
          />
        </>
      ) : null}
      {state === "boom" ? (
        <>
          <Text style={{ fontSize: 72, textAlign: "center" }}>💥</Text>
          <ResultMsg
            text={`PANG! ${names[players[boomHolderRef.current]]} höll bomben och dricker ${sipText(1, settings)}!`}
            good={false}
          />
          <Btn label="Ny runda →" onPress={newRound} />
        </>
      ) : null}
      <Btn label="Avsluta" tone="ghost" onPress={onExit} />
    </View>
  );
}

// ============================================================
// Spel 11: 21 — räkna tillsammans, bygg regler
// ============================================================

const TJUGOETT_START_RULE = "7 och 17 byter plats — säg '17' på 7 och '7' på 17";

function TwentyOneGame({ players, names, settings, onExit }: GameProps) {
  const [n, setN] = useState(1);
  const [turn, setTurn] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [round, setRound] = useState(1);
  const [rules, setRules] = useState<string[]>(
    settings.tjugoettClassic ? [TJUGOETT_START_RULE] : [],
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const [newRule, setNewRule] = useState("");

  /** count = hur många tal spelaren sa. 1 = vidare, 2 = riktningen vänds, 3 = nästa hoppas över. */
  function said(count: 1 | 2 | 3) {
    setMsg(null);
    const lastSaid = n + count - 1;
    if (lastSaid >= 21) {
      setWinner(players[turn]);
      return;
    }
    const nd = count === 2 ? ((dir * -1) as 1 | -1) : dir;
    const hop = count === 3 ? 2 : 1;
    setDir(nd);
    setN(n + count);
    setTurn((turn + nd * hop + players.length * 3) % players.length);
  }

  function fail() {
    setMsg(
      `${names[players[turn]]} sa fel (eller tvekade) och dricker ${sipText(1, settings)} — vi börjar om från 1. ${names[players[turn]]} börjar.`,
    );
    setN(1);
    setDir(1);
  }

  function nextRound() {
    const trimmed = newRule.trim();
    if (trimmed) setRules((r) => [...r, trimmed]);
    const winnerIdx = winner ? players.indexOf(winner) : 0;
    setTurn((winnerIdx + 1) % players.length);
    setWinner(null);
    setNewRule("");
    setRound((r) => r + 1);
    setN(1);
    setDir(1);
    setMsg(null);
  }

  if (winner) {
    return (
      <View style={styles.gameBody}>
        <Text style={{ fontSize: 64, textAlign: "center" }}>🥂</Text>
        <Text style={styles.h1}>21! GEMENSAM SKÅL!</Text>
        <Text style={styles.dim}>
          Alla dricker {sipText(1, settings)} tillsammans. {names[winner]} sa 21 och får hitta på en
          ny regel som gäller resten av spelet — t.ex. &quot;på 6 ska man säga 7&quot; eller
          &quot;på 12 gör man ett djurläte&quot;.
        </Text>
        <TextInput
          style={styles.input}
          placeholder={`${names[winner]}s nya regel…`}
          placeholderTextColor="#A6A39B"
          value={newRule}
          onChangeText={setNewRule}
        />
        <Btn label={`Starta runda ${round + 1} →`} onPress={nextRound} />
        <Btn label="Avsluta" tone="ghost" onPress={onExit} />
      </View>
    );
  }

  return (
    <View style={styles.gameBody}>
      <Text style={styles.phaseLabel}>21 — runda {round}</Text>
      <Text style={styles.dim}>
        Räkna till 21 med ett tal var. Sa någon två tal i rad vänds riktningen, tre tal hoppar över
        nästa spelare. Fel eller tvekan = klunk och omstart från 1.
      </Text>
      {rules.length > 0 ? (
        <View style={styles.ruleBox}>
          <Text style={styles.ruleTitle}>Gällande regler</Text>
          {rules.map((r, i) => (
            <Text key={i} style={styles.ruleText}>
              {i + 1}. {r}
            </Text>
          ))}
        </View>
      ) : null}
      <TurnBanner name={names[players[turn]] ?? "?"} />
      <Text style={styles.buzzNumber}>{n}</Text>
      <Text style={styles.dim}>
        …är nästa tal{dir === -1 ? " (riktningen är just nu omvänd ↩️)" : ""}. Kom ihåg reglerna!
      </Text>
      {msg ? <ResultMsg text={msg} good={false} /> : null}
      <Btn label="✓ Sa ett tal — vidare" onPress={() => said(1)} />
      <View style={styles.btnRow}>
        <Pressable onPress={() => said(2)} style={styles.choiceBtn}>
          <Text style={styles.btnText}>✓✓ Två tal (vänd)</Text>
        </Pressable>
        <Pressable onPress={() => said(3)} style={styles.choiceBtn}>
          <Text style={styles.btnText}>✓✓✓ Tre tal (hoppa)</Text>
        </Pressable>
      </View>
      <Btn label="✗ Fel! Klunk + omstart" tone="danger" onPress={fail} />
      <Btn label="Avsluta" tone="ghost" onPress={onExit} />
    </View>
  );
}

// ============================================================
// GameCenter: meny + delad lobby + spelväxel
// ============================================================

export default function GameCenter({
  visible,
  onClose,
  groupId,
  members,
}: {
  visible: boolean;
  onClose: () => void;
  groupId: string;
  members: GameMember[];
}) {
  const [phase, setPhase] = useState<"menu" | "setup" | "play">("menu");
  const [game, setGame] = useState<GameId | null>(null);
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [starting, setStarting] = useState(false);
  // Gästspelare: polare på plats som inte är med i chatten. Spelar med i alla
  // spel men skickas inte till servern (inga poäng, inga konton).
  const [guests, setGuests] = useState<GameMember[]>([]);
  const [guestName, setGuestName] = useState("");
  const guestSeq = useRef(0);

  const allPlayers = useMemo(() => [...members, ...guests], [members, guests]);
  const names = useMemo(
    () => Object.fromEntries(allPlayers.map((m) => [m.id, m.name])),
    [allPlayers],
  );
  const gameDef = GAMES.find((g) => g.id === game);

  function togglePlayer(id: string) {
    setPlayerIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  function patch(p: Partial<GameSettings>) {
    setSettings((prev) => ({ ...prev, ...p }));
  }

  function addGuest() {
    const name = guestName.trim();
    if (!name) return;
    guestSeq.current += 1;
    const guest = { id: `guest:${guestSeq.current}`, name };
    setGuests((prev) => [...prev, guest]);
    setPlayerIds((prev) => [...prev, guest.id]);
    setGuestName("");
  }

  async function start() {
    if (!gameDef || playerIds.length < 2 || starting) return;
    setStarting(true);
    // Bara riktiga gruppmedlemmar rapporteras till servern — gäster får inga poäng.
    const memberIds = playerIds.filter((id) => !id.startsWith("guest:"));
    if (memberIds.length > 0) {
      const { error } = await supabase.rpc("start_drinking_game", {
        gid: groupId,
        game_name: gameDef.title,
        participant_ids: memberIds,
      });
      if (error) {
        setStarting(false);
        return;
      }
    }
    setStarting(false);
    setPhase("play");
  }

  function exitGame() {
    setPhase("menu");
    setGame(null);
    setPlayerIds([]);
  }

  function close() {
    exitGame();
    setGuests([]);
    setGuestName("");
    onClose();
  }

  const gameProps: GameProps = {
    players: playerIds,
    names,
    settings,
    onExit: exitGame,
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={phase === "menu" ? close : exitGame} hitSlop={8}>
            <Text style={{ color: "#A6A39B", fontSize: 26 }}>{phase === "menu" ? "×" : "‹"}</Text>
          </Pressable>
          <Text style={styles.headerTitle}>
            {phase === "menu" ? "🎮 Spel" : `${gameDef?.emoji} ${gameDef?.title}`}
          </Text>
          <View style={{ width: 26 }} />
        </View>

        {!settings.alcoholFree && phase !== "menu" ? (
          <Text style={styles.responsible}>🔞 Drick ansvarsfullt — och aldrig under 18.</Text>
        ) : null}

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {phase === "menu" ? (
            <View style={styles.gameBody}>
              <Text style={styles.category}>🍺 Drickspel</Text>
              {GAMES.filter((g) => g.category === "drick").map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => {
                    setGame(g.id);
                    setPhase("setup");
                  }}
                  style={styles.menuCard}
                >
                  <Text style={{ fontSize: 32 }}>{g.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.menuTitle}>{g.title}</Text>
                    <Text style={styles.dim}>{g.desc}</Text>
                  </View>
                </Pressable>
              ))}
              <Text style={styles.category}>🎯 Utmaningar</Text>
              {GAMES.filter((g) => g.category === "utmaning").map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => {
                    setGame(g.id);
                    setPhase("setup");
                  }}
                  style={styles.menuCard}
                >
                  <Text style={{ fontSize: 32 }}>{g.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.menuTitle}>{g.title}</Text>
                    <Text style={styles.dim}>{g.desc}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}

          {phase === "setup" && gameDef ? (
            <View style={styles.gameBody}>
              <Text style={styles.h1}>Vilka är med?</Text>
              <Text style={styles.dim}>
                Bocka i spelarna i den ordning ni sitter runt bordet — turordningen följer den. Alla
                får +10 poäng.
              </Text>
              {allPlayers.map((m) => {
                const order = playerIds.indexOf(m.id);
                const isGuest = m.id.startsWith("guest:");
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => togglePlayer(m.id)}
                    style={[styles.playerRow, order >= 0 ? styles.playerRowSelected : null]}
                  >
                    <View style={[styles.orderBadge, order < 0 ? { opacity: 0.25 } : null]}>
                      <Text style={styles.orderText}>{order >= 0 ? order + 1 : "–"}</Text>
                    </View>
                    <Text style={styles.playerName}>
                      {m.name}
                      {isGuest ? "  🧑‍🤝‍🧑 gäst" : ""}
                    </Text>
                  </Pressable>
                );
              })}

              <Text style={styles.category}>Gästspelare</Text>
              <Text style={styles.dim}>
                Lägg till polare som är på plats men inte med i chatten. Gäster spelar med i allt
                men får inga poäng.
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Gästens namn…"
                  placeholderTextColor="#A6A39B"
                  value={guestName}
                  onChangeText={setGuestName}
                  onSubmitEditing={addGuest}
                  returnKeyType="done"
                />
                <Btn label="+ Lägg till" onPress={addGuest} disabled={!guestName.trim()} />
              </View>

              <Text style={styles.category}>Inställningar</Text>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>Alkoholfritt sip-läge</Text>
                <Switch value={settings.alcoholFree} onValueChange={(v) => patch({ alcoholFree: v })} />
              </View>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>18+ innehåll</Text>
                <Switch value={settings.adult} onValueChange={(v) => patch({ adult: v })} />
              </View>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>Straff (klunkar per straffenhet)</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {[1, 2, 3].map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => patch({ sips: s })}
                      style={[styles.miniChip, settings.sips === s ? styles.miniChipOn : null]}
                    >
                      <Text style={styles.nameChipText}>{s}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {game === "nhie" ? (
                <>
                  <View style={styles.settingRow}>
                    <Text style={styles.settingLabel}>Nivå</Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {(["mild", "kryddig", "grabbig"] as PromptLevel[]).map((l) => {
                        const locked = l !== "mild" && !settings.adult;
                        return (
                          <Pressable
                            key={l}
                            disabled={locked}
                            onPress={() => patch({ level: l })}
                            style={[
                              styles.miniChip,
                              settings.level === l && !locked ? styles.miniChipOn : null,
                              locked ? { opacity: 0.35 } : null,
                            ]}
                          >
                            <Text style={styles.nameChipText}>{locked ? `🔒 ${l}` : l}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                  <View style={styles.settingRow}>
                    <Text style={styles.settingLabel}>Tävlingsläge (3 liv)</Text>
                    <Switch
                      value={settings.nhieCompetitive}
                      onValueChange={(v) => patch({ nhieCompetitive: v })}
                    />
                  </View>
                </>
              ) : null}

              {game === "tod" ? (
                <View style={styles.settingRow}>
                  <Text style={styles.settingLabel}>Intensitet</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {(["gron", "gul", "rod"] as Intensity[]).map((l) => {
                      const locked = l !== "gron" && !settings.adult;
                      const label = l === "gron" ? "🟢" : l === "gul" ? "🟡" : "🔴";
                      return (
                        <Pressable
                          key={l}
                          disabled={locked}
                          onPress={() => patch({ intensity: l })}
                          style={[
                            styles.miniChip,
                            settings.intensity === l && !locked ? styles.miniChipOn : null,
                            locked ? { opacity: 0.35 } : null,
                          ]}
                        >
                          <Text style={styles.nameChipText}>{locked ? "🔒" : label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {game === "mexico" ? (
                <View style={styles.settingRow}>
                  <Text style={styles.settingLabel}>Enkelt läge (utan bluff)</Text>
                  <Switch
                    value={settings.mexicoSimple}
                    onValueChange={(v) => patch({ mexicoSimple: v })}
                  />
                </View>
              ) : null}

              {game === "buzz" ? (
                <View style={styles.settingRow}>
                  <Text style={styles.settingLabel}>Extra buzz-tal</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {[null, 3, 5, 9].map((v) => (
                      <Pressable
                        key={String(v)}
                        onPress={() => patch({ buzzExtra: v })}
                        style={[styles.miniChip, settings.buzzExtra === v ? styles.miniChipOn : null]}
                      >
                        <Text style={styles.nameChipText}>{v ?? "Av"}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              {game === "tjugoett" ? (
                <View style={styles.settingRow}>
                  <Text style={styles.settingLabel}>Klassisk startregel (7 och 17 byter plats)</Text>
                  <Switch
                    value={settings.tjugoettClassic}
                    onValueChange={(v) => patch({ tjugoettClassic: v })}
                  />
                </View>
              ) : null}

              {game === "roulette" ? (
                <View style={styles.settingRow}>
                  <Text style={styles.settingLabel}>Djärvt läge 😈 (kräver 18+)</Text>
                  <Switch
                    value={settings.rouletteDare && settings.adult}
                    disabled={!settings.adult}
                    onValueChange={(v) => patch({ rouletteDare: v })}
                  />
                </View>
              ) : null}

              <Btn
                label={
                  starting
                    ? "Startar…"
                    : `Starta ${gameDef.title} (${playerIds.length} spelare)`
                }
                onPress={start}
                disabled={playerIds.length < 2 || starting}
              />
            </View>
          ) : null}

          {phase === "play" && game === "kingscup" ? <KingsCupGame {...gameProps} /> : null}
          {phase === "play" && game === "bus" ? <RideTheBusGame {...gameProps} /> : null}
          {phase === "play" && game === "mexico" ? <MexicoGame {...gameProps} /> : null}
          {phase === "play" && game === "nhie" ? <NeverEverGame {...gameProps} /> : null}
          {phase === "play" && game === "tod" ? <TruthDareGame {...gameProps} /> : null}
          {phase === "play" && game === "mostlikely" ? <MostLikelyGame {...gameProps} /> : null}
          {phase === "play" && game === "paranoia" ? <ParanoiaGame {...gameProps} /> : null}
          {phase === "play" && game === "buzz" ? <BuzzGame {...gameProps} /> : null}
          {phase === "play" && game === "roulette" ? <RouletteGame {...gameProps} /> : null}
          {phase === "play" && game === "bomb" ? <BombGame {...gameProps} /> : null}
          {phase === "play" && game === "tjugoett" ? <TwentyOneGame {...gameProps} /> : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#262624" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  responsible: {
    color: "#fbbf24",
    fontSize: 11,
    textAlign: "center",
    paddingBottom: 4,
    fontWeight: "600",
  },
  gameBody: { padding: 20, gap: 12 },
  category: { color: "#A6A39B", fontSize: 14, fontWeight: "800", marginTop: 8 },
  menuCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 0,
    padding: 16,
  },
  menuTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  dim: { color: "#A6A39B", fontSize: 13 },
  h1: { color: "#fff", fontSize: 20, fontWeight: "800", textAlign: "center" },
  h2: { color: "#fff", fontSize: 16, fontWeight: "700", textAlign: "center" },
  phaseLabel: { color: "#D4AF37", fontSize: 13, fontWeight: "800", textAlign: "center" },
  turnBanner: { alignItems: "center", gap: 2 },
  turnLabel: { color: "#A6A39B", fontSize: 13 },
  turnName: { color: "#fff", fontSize: 26, fontWeight: "900" },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 0,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "transparent",
  },
  playerRowSelected: { borderColor: "#D4AF37" },
  orderBadge: {
    width: 26,
    height: 26,
    borderRadius: 0,
    backgroundColor: "#D4AF37",
    alignItems: "center",
    justifyContent: "center",
  },
  orderText: { color: "#15151B", fontWeight: "900", fontSize: 13 },
  playerName: { color: "#fff", fontSize: 15, fontWeight: "600" },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 4,
  },
  settingLabel: { color: "#fff", fontSize: 14, fontWeight: "600", flexShrink: 1 },
  input: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 0,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#fff",
    fontSize: 15,
  },
  miniChip: {
    borderRadius: 0,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "transparent",
  },
  miniChipOn: { borderColor: "#D4AF37", backgroundColor: "rgba(242,169,22,0.25)" },
  btn: {
    backgroundColor: "#3D5AFE",
    borderRadius: 0,
    paddingVertical: 14,
    alignItems: "center",
    paddingHorizontal: 24,
  },
  btnGhost: { backgroundColor: "rgba(255,255,255,0.1)" },
  btnDanger: { backgroundColor: "#FF4C29" },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  btnRow: { flexDirection: "row", gap: 10, justifyContent: "center", flexWrap: "wrap" },
  choiceBtn: {
    backgroundColor: "#3D5AFE",
    borderRadius: 0,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
    minWidth: 90,
  },
  nameGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  nameChip: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 0,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  nameChipHot: { borderColor: "#D4AF37", backgroundColor: "rgba(242,169,22,0.35)" },
  nameChipText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  resultBox: { borderRadius: 0, padding: 12 },
  resultGood: { backgroundColor: "rgba(34,197,94,0.25)" },
  resultBad: { backgroundColor: "rgba(220,38,38,0.3)" },
  resultText: { color: "#fff", fontWeight: "700", fontSize: 14, textAlign: "center" },
  promptCard: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 0,
    padding: 18,
  },
  promptText: { color: "#fff", fontSize: 17, fontWeight: "700", textAlign: "center", lineHeight: 24 },
  peekBox: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 0,
    padding: 18,
    borderWidth: 1,
    borderColor: "#3D5AFE",
    alignItems: "center",
  },
  bigCard: {
    width: 170,
    height: 240,
    backgroundColor: "#fff",
    borderRadius: 0,
    padding: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  bigCardCorner: { position: "absolute", top: 10, left: 12, fontSize: 22, fontWeight: "900" },
  bigCardSuit: { fontSize: 84 },
  cardBack: {
    width: 170,
    height: 240,
    backgroundColor: "#8a5a2b",
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 3,
    borderColor: "#3D5AFE",
  },
  cardBackText: { color: "#A6A39B", fontSize: 13, fontWeight: "700", textAlign: "center" },
  ruleBox: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 0, padding: 14, gap: 6 },
  ruleTitle: { color: "#D4AF37", fontSize: 16, fontWeight: "800" },
  ruleText: { color: "#fff", fontSize: 14, lineHeight: 20 },
  statusRow: { flexDirection: "row", justifyContent: "space-between" },
  handRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" },
  pCard: {
    width: 44,
    height: 60,
    backgroundColor: "#fff",
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  pCardSmall: { width: 40, height: 54 },
  pCardText: { fontSize: 16, fontWeight: "900" },
  pCardTextSmall: { fontSize: 13, fontWeight: "900" },
  pCardBack: {
    width: 40,
    height: 54,
    backgroundColor: "#8a5a2b",
    borderRadius: 0,
    borderWidth: 1,
    borderColor: "#3D5AFE",
  },
  pyramid: { gap: 6, alignItems: "center" },
  pyramidRow: { flexDirection: "row", gap: 6, justifyContent: "center" },
  buzzNumber: { color: "#fff", fontSize: 72, fontWeight: "900", textAlign: "center" },
  timerTrack: {
    height: 8,
    borderRadius: 0,
    backgroundColor: "rgba(255,255,255,0.15)",
    overflow: "hidden",
  },
  timerFill: { height: 8, backgroundColor: "#D4AF37" },
});
