import { View } from "react-native";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";

import type { Category } from "@/lib/huntCards";

/**
 * Levande, unika kortillustrationer — varje utmaning (id) får sin egen
 * form, färgsättning, rotation och skala, seedad så den alltid ser likadan
 * ut för samma kort men skiljer sig från grannarna. Motiven är tänkta att
 * gå att känna igen (hantel, ölstop, mic, knytnävar…) snarare än rena
 * former, och får gärna svämma över den inre ramen — det är poängen med
 * dynamiken.
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

/** Appens accentpalett — ett kort får EN accent + ink, inte två blekta pasteller. */
const ACCENTS = ["#3D5AFE", "#FF4C29", "#00B884", "#96781F"];
const INK = "#15151B";
const PAPER = "#F5F4F0";

/** Lägger på alfa som hex-suffix, så varje form kan ha egen täckningsgrad. */
function alpha(hex: string, a: number) {
  return hex + Math.round(a * 255).toString(16).padStart(2, "0").toUpperCase();
}

function pickAccent(rand: () => number) {
  return ACCENTS[Math.floor(rand() * ACCENTS.length)];
}

const MATERIAL_HEART =
  "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z";

function Art({ category, rand, accent }: { category: Category; rand: () => number; accent: string }) {
  const fill = alpha(accent, 0.62);
  const dark = alpha(INK, 0.5);

  switch (category) {
    case "gang": {
      // Tre gubbar axel mot axel — grabbgänget samlat, huvud + rundad kropp.
      const wobble = (rand() - 0.5) * 10;
      const people = [
        { cx: 15 + wobble * 0.4, scale: 0.8, tone: fill },
        { cx: 34 + wobble, scale: 1.08, tone: dark },
        { cx: 53 - wobble * 0.4, scale: 0.84, tone: fill },
      ];
      return (
        <>
          {people.map((p, i) => {
            const r = 11 * p.scale;
            const footY = 97;
            const apexY = footY - r * 1.7;
            const headR = r * 0.55;
            return (
              <G key={i}>
                <Path
                  d={`M${p.cx - r} ${footY}
                      L${p.cx - r} ${footY - r * 0.5}
                      Q${p.cx - r} ${apexY} ${p.cx} ${apexY}
                      Q${p.cx + r} ${apexY} ${p.cx + r} ${footY - r * 0.5}
                      L${p.cx + r} ${footY} Z`}
                  fill={p.tone}
                />
                <Circle cx={p.cx} cy={apexY - headR - 2} r={headR} fill={p.tone} />
              </G>
            );
          })}
        </>
      );
    }
    case "social": {
      // Två knytnävar som möts underifrån — en fistbump, med ett litet smällmärke.
      const hitX = 34 + (rand() - 0.5) * 6;
      const hitY = 58 + (rand() - 0.5) * 8;
      const armLen = 26 + rand() * 10;
      const fistR = 8 + rand() * 2.5;
      const gap = fistR * 0.35;
      const angle1 = ((200 + rand() * 25) * Math.PI) / 180; // ner-vänster
      const angle2 = ((-60 + rand() * 25) * Math.PI) / 180; // ner-höger
      const arm = (angle: number, tone: string) => {
        const farX = hitX + Math.cos(angle) * armLen;
        const farY = hitY + Math.sin(angle) * armLen;
        const nearX = hitX + Math.cos(angle) * gap;
        const nearY = hitY + Math.sin(angle) * gap;
        return (
          <>
            <Path
              d={`M${farX} ${farY} L${nearX} ${nearY}`}
              stroke={tone}
              strokeWidth={fistR * 1.3}
              strokeLinecap="round"
            />
            <Circle cx={nearX} cy={nearY} r={fistR} fill={tone} />
          </>
        );
      };
      return (
        <>
          {arm(angle1, fill)}
          {arm(angle2, dark)}
          {[-130, -90, -50].map((deg, i) => {
            const a = (deg * Math.PI) / 180;
            return (
              <Path
                key={i}
                d={`M${hitX + Math.cos(a) * (fistR + 3)} ${hitY + Math.sin(a) * (fistR + 3)} L${hitX + Math.cos(a) * (fistR + 10)} ${hitY + Math.sin(a) * (fistR + 10)}`}
                stroke={dark}
                strokeWidth={2.2}
                strokeLinecap="round"
              />
            );
          })}
        </>
      );
    }
    case "charm": {
      // Beprövad hjärtform (Material-ikon), skalad upp och lätt vriden.
      const s = 2.5 + rand() * 0.9;
      const tilt = (rand() - 0.5) * 24;
      const tx = 34 - 12 * s;
      const ty = 58 - 12 * s;
      const sparkX = 34 + 14 + rand() * 8;
      const sparkY = 48 + rand() * 10;
      return (
        <>
          <G transform={`translate(${tx} ${ty}) scale(${s}) rotate(${tilt} 12 12)`}>
            <Path d={MATERIAL_HEART} fill={fill} />
          </G>
          <Circle cx={sparkX} cy={sparkY} r={3.4} fill={dark} />
          <Circle cx={sparkX - 9} cy={sparkY + 10} r={2} fill={dark} />
        </>
      );
    }
    case "scen": {
      // Mic med "on air"-bågar på sidorna — sång/tal/uppträdande.
      const tilt = (rand() - 0.5) * 16;
      const bob = rand() * 6;
      return (
        <G transform={`rotate(${tilt} 34 62)`}>
          <Rect x={28} y={38 - bob} width={12} height={24} rx={6} fill={fill} />
          <Rect x={32.5} y={61 - bob} width={3} height={24} fill={dark} />
          <Path d={`M24 ${86 - bob} A10 5 0 0 0 44 ${86 - bob}`} stroke={dark} strokeWidth={3} fill="none" />
          <Path d={`M18 ${44 - bob} Q11 ${50 - bob} 18 ${56 - bob}`} stroke={fill} strokeWidth={2.6} fill="none" />
          <Path d={`M50 ${44 - bob} Q57 ${50 - bob} 50 ${56 - bob}`} stroke={fill} strokeWidth={2.6} fill="none" />
        </G>
      );
    }
    case "fys": {
      // Skivstång med vikter i vardera änden — mitt i ett lyft.
      const barLen = 34 + rand() * 12;
      const plateR = 11 + rand() * 4;
      const angle = -26 + rand() * 52;
      const leftX = 34 - barLen / 2;
      const rightX = 34 + barLen / 2;
      return (
        <G transform={`rotate(${angle} 34 75)`}>
          <Rect x={leftX} y={72.5} width={barLen} height={5} rx={2.5} fill={dark} />
          <Circle cx={leftX} cy={75} r={plateR} fill={fill} />
          <Circle cx={leftX} cy={75} r={plateR * 0.5} fill={dark} />
          <Circle cx={rightX} cy={75} r={plateR} fill={fill} />
          <Circle cx={rightX} cy={75} r={plateR * 0.5} fill={dark} />
        </G>
      );
    }
    case "dryck": {
      // Ölstop: kropp + handtag + skum — tydligt vad kvällen bjuder på.
      const tilt = (rand() - 0.5) * 18;
      const w = 22 + rand() * 6;
      return (
        <G transform={`rotate(${tilt} 34 74)`}>
          <Rect x={34 - w / 2} y={54} width={w} height={40} rx={4} fill={fill} />
          <Path
            d={`M${34 + w / 2 - 2} 60 Q${34 + w / 2 + 13} 60 ${34 + w / 2 + 13} 74 Q${34 + w / 2 + 13} 88 ${34 + w / 2 - 2} 88`}
            stroke={dark}
            strokeWidth={4.5}
            fill="none"
          />
          <Circle cx={34 - w / 5} cy={54} r={4.2} fill={PAPER} opacity={0.85} />
          <Circle cx={34 + w / 6} cy={52} r={5} fill={PAPER} opacity={0.85} />
          <Circle cx={34 + w / 2 - 6} cy={55} r={3.4} fill={PAPER} opacity={0.85} />
        </G>
      );
    }
    default:
      return null;
  }
}

/**
 * Absolut positionerad bakgrundsgrafik på jaktkorten — seedad på `seed`
 * (challenge.id) så varje kort blir unikt men stabilt. Renderas som första
 * barn i JSX-ordningen så texten alltid hamnar ovanpå.
 *
 * Duken görs medvetet större än sitt eget utrymme (bleed) så motivet får
 * svämma över den inre ramen; föräldern (kortets yttre yta) klipper med
 * overflow:hidden vid kortets rundade hörn, så det sprider sig aldrig in i
 * grannkorten i rutnätet.
 */
export function CategoryArt({ category, seed }: { category: Category; seed: number }) {
  const rand = rngFor(seed);
  const accent = pickAccent(rand);
  const bleed = 28 + rand() * 30; // % — hur mycket duken är större än kortet
  const jitterX = (rand() - 0.5) * 16;
  const jitterY = (rand() - 0.5) * 10;

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
      <Svg width="100%" height="100%" viewBox="0 0 68 100">
        <Art category={category} rand={rand} accent={accent} />
      </Svg>
    </View>
  );
}
