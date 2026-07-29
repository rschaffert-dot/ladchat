import Svg, { Circle, Path, Rect } from "react-native-svg";

/**
 * Grekiska gudar som gruppavatarer — ersätter bokstavsinitialen. Samma
 * enkla byst (huvud + axlar, vit) för alla, med ETT fett, färgat attribut
 * i högerkanten som gör guden igenkännbar även vid 44px: blixt, treudd,
 * sköld, sol eller vinge. Vald deterministiskt per gruppnamn, precis som
 * bakgrundsfärgen — men med en annan hashfunktion så de inte alltid följs åt.
 */

export type God = "zeus" | "poseidon" | "ares" | "apollo" | "hermes";

const GODS: God[] = ["zeus", "poseidon", "ares", "apollo", "hermes"];

/** Guldaccent på attributet — som en förgylld detalj på en marmorbyst. */
const GOLD = "#D4AF37";

export function pickGod(name: string): God {
  let h = 0;
  for (const ch of name) h = (h * 17 + ch.charCodeAt(0)) >>> 0;
  return GODS[h % GODS.length];
}

/** Bystens grundform: cirkelhuvud + togaskuldror, i vänsterhalvan av rutan. */
function Bust({ fill }: { fill: string }) {
  return (
    <>
      <Path d="M6 58 L15 32 L27 32 L36 58 Z" fill={fill} />
      <Circle cx="21" cy="18" r="13" fill={fill} />
    </>
  );
}

function Attribute({ god, color }: { god: God; color: string }) {
  switch (god) {
    case "zeus":
      // Blixt.
      return <Path d="M51 2 L36 28 L46 28 L38 50 L62 22 L50 22 Z" fill={color} />;
    case "poseidon":
      // Treudd: skaft + tvärslå + tre uddar.
      return (
        <>
          <Rect x="46" y="14" width="5" height="34" rx="1.5" fill={color} />
          <Rect x="36" y="12" width="24" height="5" rx="2" fill={color} />
          <Path d="M38 12 L44 12 L41 0 Z" fill={color} />
          <Path d="M46 12 L52 12 L49 -2 Z" fill={color} />
          <Path d="M54 12 L60 12 L57 0 Z" fill={color} />
        </>
      );
    case "ares":
      // Sköld.
      return (
        <Path
          d="M48 2 L62 8 L62 24 Q62 40 48 48 Q34 40 34 24 L34 8 Z"
          fill={color}
        />
      );
    case "apollo": {
      // Sol: cirkel + strålar runt om.
      const rays = Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        const cx = 49,
          cy = 24;
        const r1 = 11,
          r2 = 18;
        const spread = 0.22;
        const x1 = cx + Math.cos(a - spread) * r1;
        const y1 = cy + Math.sin(a - spread) * r1;
        const x2 = cx + Math.cos(a + spread) * r1;
        const y2 = cy + Math.sin(a + spread) * r1;
        const xt = cx + Math.cos(a) * r2;
        const yt = cy + Math.sin(a) * r2;
        return <Path key={i} d={`M${x1} ${y1} L${xt} ${yt} L${x2} ${y2} Z`} fill={color} />;
      });
      return (
        <>
          {rays}
          <Circle cx="49" cy="24" r="10" fill={color} />
        </>
      );
    }
    case "hermes":
      // Vinge.
      return <Path d="M36 22 Q46 2 63 6 Q55 18 63 28 Q46 32 36 22 Z" fill={color} />;
    default:
      return null;
  }
}

export function GodSilhouette({
  god,
  size = 28,
  bustColor = "#fff",
  attributeColor = GOLD,
}: {
  god: God;
  size?: number;
  bustColor?: string;
  attributeColor?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Bust fill={bustColor} />
      <Attribute god={god} color={attributeColor} />
    </Svg>
  );
}
