import { View } from "react-native";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";

import type { Category } from "@/lib/huntCards";

/**
 * Levande, unika kortillustrationer — varje utmaning (id) får sin egen
 * form, färgsättning, rotation och skala, seedad så den alltid ser likadan
 * ut för samma kort men skiljer sig från grannarna. Motivet får gärna
 * svämma över den inre ramen; det är poängen med dynamiken.
 */

/** Deterministisk PRNG (mulberry32) — samma id ger alltid samma bild. */
function rngFor(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Appens accentpalett — motiven hämtar färg härifrån i stället för en enda dov tier-ton. */
const ACCENTS = ["#3D5AFE", "#FF4C29", "#00B884", "#D4AF37"];

function pickTwo(rand: () => number): [string, string] {
  const a = Math.floor(rand() * ACCENTS.length);
  let b = Math.floor(rand() * ACCENTS.length);
  if (b === a) b = (b + 1) % ACCENTS.length;
  return [ACCENTS[a], ACCENTS[b]];
}

function Art({
  category,
  rand,
  tint1,
  tint2,
}: {
  category: Category;
  rand: () => number;
  tint1: string;
  tint2: string;
}) {
  switch (category) {
    case "gang": {
      // Löst kluster av överlappande cirklar — grabbgänget samlat, varje kort får egen spridning.
      const r1 = 8 + rand() * 5;
      const r2 = 10 + rand() * 6;
      const r3 = 8 + rand() * 5;
      const spread = 12 + rand() * 8;
      return (
        <>
          <Circle cx={34 - spread} cy={80 + rand() * 8} r={r1} fill={tint1} />
          <Circle cx={34 + spread} cy={80 + rand() * 8} r={r3} fill={tint2} />
          <Circle cx={34 + (rand() - 0.5) * 10} cy={68 + rand() * 8} r={r2} fill={tint1} />
        </>
      );
    }
    case "social": {
      // Två möten cirklar — främlingar som korsar varandras väg, varierad överlappning.
      const r = 14 + rand() * 6;
      const gap = 8 + rand() * 14;
      return (
        <>
          <Circle cx={34 - gap} cy={65 + rand() * 10} r={r} fill={tint1} />
          <Circle cx={34 + gap} cy={65 + rand() * 10} r={r} fill={tint2} />
        </>
      );
    }
    case "charm": {
      // Två lober + spets — ett abstrakt hjärta, tilt och storlek varierar.
      const lobeR = 9 + rand() * 4;
      const lobeGap = 12 + rand() * 6;
      const tipY = 88 + rand() * 12;
      const tilt = (rand() - 0.5) * 20;
      return (
        <G transform={`rotate(${tilt} 34 72)`}>
          <Circle cx={34 - lobeGap / 2} cy={64} r={lobeR} fill={tint1} />
          <Circle cx={34 + lobeGap / 2} cy={64} r={lobeR} fill={tint1} />
          <Path
            d={`M${34 - lobeGap - lobeR / 2} 70 L34 ${tipY} L${34 + lobeGap + lobeR / 2} 70 Z`}
            fill={tint2}
          />
        </G>
      );
    }
    case "scen": {
      // Ljudvågor/strålkastare som ringar ut från en punkt — antal och radie varierar.
      const rings = 2 + Math.floor(rand() * 3);
      const base = 12 + rand() * 6;
      const step = 9 + rand() * 5;
      return (
        <>
          <Circle cx="34" cy="92" r="4" fill={tint1} />
          {Array.from({ length: rings }, (_, i) => {
            const r = base + step * (i + 1);
            return (
              <Path
                key={i}
                d={`M${34 - r} 92 A${r} ${r} 0 0 1 ${34 + r} 92`}
                stroke={i % 2 === 0 ? tint1 : tint2}
                strokeWidth={3}
                fill="none"
              />
            );
          })}
        </>
      );
    }
    case "fys": {
      // Hantel — två vikter på en stång, vinkel och storlek varierar per kort.
      const wr = 8 + rand() * 5;
      const barLen = 20 + rand() * 12;
      const angle = -30 + rand() * 60;
      return (
        <G transform={`rotate(${angle} 34 75)`}>
          <Circle cx={34 - barLen / 2} cy="75" r={wr} fill={tint1} />
          <Circle cx={34 + barLen / 2} cy="75" r={wr} fill={tint2} />
          <Rect x={34 - barLen / 2 + wr * 0.4} y="71" width={barLen - wr * 0.8} height="8" rx="4" fill={tint1} />
        </G>
      );
    }
    case "dryck": {
      // Ölglas: avsmalnande form + bubblor, tilt och bubbelplacering varierar.
      const tilt = (rand() - 0.5) * 24;
      const bubbles = 2 + Math.floor(rand() * 3);
      return (
        <G transform={`rotate(${tilt} 34 75)`}>
          <Path d="M23 56 L45 56 L41 93 L27 93 Z" fill={tint1} />
          <Rect x="25" y="73" width="18" height="3" fill={tint2} opacity={0.7} />
          {Array.from({ length: bubbles }, (_, i) => (
            <Circle
              key={i}
              cx={28 + rand() * 12}
              cy={60 + rand() * 10}
              r={1.4 + rand() * 1.4}
              fill={tint2}
              opacity={0.7}
            />
          ))}
        </G>
      );
    }
    default:
      return null;
  }
}

/**
 * Absolut positionerad, färgstark bakgrundsgrafik på jaktkorten — seedad på
 * `seed` (challenge.id) så varje kort blir unikt men stabilt. Renderas som
 * första barn i JSX-ordningen så texten alltid hamnar ovanpå.
 *
 * Duken görs medvetet större än sitt eget utrymme (bleed) så motivet får
 * svämma över den inre ramen; föräldern (kortets yttre yta) klipper med
 * overflow:hidden vid kortets rundade hörn, så det sprider sig aldrig in i
 * grannkorten i rutnätet.
 */
export function CategoryArt({
  category,
  seed,
  opacity = 0.3,
}: {
  category: Category;
  seed: number;
  opacity?: number;
}) {
  const rand = rngFor(seed);
  const [tint1, tint2] = pickTwo(rand);
  const bleed = 16 + rand() * 26; // % — hur mycket duken är större än kortet
  const jitterX = (rand() - 0.5) * 14; // % — extra sidledes förskjutning
  const jitterY = (rand() - 0.5) * 14;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: `${-bleed / 2 + jitterY}%`,
        left: `${-bleed / 2 + jitterX}%`,
        width: `${100 + bleed}%`,
        height: `${100 + bleed}%`,
      }}
    >
      <Svg width="100%" height="100%" viewBox="0 0 68 100" opacity={opacity}>
        <Art category={category} rand={rand} tint1={tint1} tint2={tint2} />
      </Svg>
    </View>
  );
}
