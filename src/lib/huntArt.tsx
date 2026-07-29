import { Circle, Path, Rect, Svg } from "react-native-svg";
import { StyleSheet } from "react-native";

import type { Category } from "@/lib/huntCards";

/**
 * Diskreta bakgrundsillustrationer per kategori — abstrakta former, inte
 * bokstavliga ikonkopior, så korten känns roligare utan att ta över texten.
 * viewBox 0 0 68 100 matchar kortets aspectRatio (0.68) rakt av.
 */
function Art({ category, tint }: { category: Category; tint: string }) {
  switch (category) {
    case "gang":
      // Löst kluster av överlappande cirklar — grabbgänget samlat.
      return (
        <>
          <Circle cx="20" cy="80" r="9" fill={tint} />
          <Circle cx="48" cy="80" r="9" fill={tint} />
          <Circle cx="34" cy="70" r="12" fill={tint} />
        </>
      );
    case "social":
      // Två möten cirklar — främlingar som korsar varandras väg.
      return (
        <>
          <Circle cx="25" cy="68" r="16" fill={tint} />
          <Circle cx="45" cy="68" r="16" fill={tint} />
        </>
      );
    case "charm":
      // Två lober + spets — ett abstrakt hjärta.
      return (
        <>
          <Circle cx="27" cy="66" r="11" fill={tint} />
          <Circle cx="41" cy="66" r="11" fill={tint} />
          <Path d="M16 72 L34 94 L52 72 Z" fill={tint} />
        </>
      );
    case "scen":
      // Ljudvågor/strålkastare som ringar ut från en punkt.
      return (
        <>
          <Circle cx="34" cy="92" r="4" fill={tint} />
          <Path d="M20 92 A14 14 0 0 1 48 92" stroke={tint} strokeWidth={3} fill="none" />
          <Path d="M11 92 A23 23 0 0 1 57 92" stroke={tint} strokeWidth={3} fill="none" />
          <Path d="M2 92 A32 32 0 0 1 66 92" stroke={tint} strokeWidth={3} fill="none" />
        </>
      );
    case "fys":
      // Hantel — två vikter på en stång, lätt vridd för dynamik.
      return (
        <Path
          d="M18 65a10 10 0 1 0 0 20 10 10 0 1 0 0-20zM50 65a10 10 0 1 0 0 20 10 10 0 1 0 0-20zM22 71h24v8H22z"
          fill={tint}
          transform="rotate(-14 34 75)"
        />
      );
    case "dryck":
      // Ölglas: avsmalnande form + nivålinje + bubblor.
      return (
        <>
          <Path d="M23 56 L45 56 L41 93 L27 93 Z" fill={tint} />
          <Rect x="25" y="73" width="18" height="3" fill="#F5F4F0" opacity={0.6} />
          <Circle cx="31" cy="64" r="2" fill="#F5F4F0" opacity={0.6} />
          <Circle cx="37" cy="68" r="1.6" fill="#F5F4F0" opacity={0.6} />
        </>
      );
    default:
      return null;
  }
}

/**
 * Absolut positionerad, lågkontrast bakgrundsgrafik på jaktkorten. Ligger
 * bakom korttexten i JSX-ordningen, så inget zIndex behövs.
 */
export function CategoryArt({
  category,
  tint,
  opacity = 0.16,
}: {
  category: Category;
  tint: string;
  opacity?: number;
}) {
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      viewBox="0 0 68 100"
      opacity={opacity}
      preserveAspectRatio="xMidYMid slice"
      pointerEvents="none"
    >
      <Art category={category} tint={tint} />
    </Svg>
  );
}
