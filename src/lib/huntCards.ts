import { Platform } from "react-native";

/**
 * Delad kortdata för Poängjakten: tier-/kategoriutseende och domäntyper.
 * Används av jaktvyn (src/app/hunt) och LadBook på profilen, så korten
 * ser likadana ut överallt.
 */

/** Kortens rubrikfont: Space Grotesk på web (global.css), systemfont på native. */
export const HUNT_SERIF = Platform.select({
  web: "'Space Grotesk', Inter, sans-serif",
  default: "system-ui",
});

export type Tier = "wood" | "bronze" | "silver" | "gold" | "diamond";

export type Category = "gang" | "social" | "charm" | "scen" | "fys" | "dryck";

export const CATEGORY_ORDER: Category[] = ["gang", "social", "charm", "scen", "fys", "dryck"];

export const CATEGORIES: Record<Category, { label: string; emoji: string }> = {
  gang: { label: "Gänget", emoji: "👊" },
  social: { label: "Främlingar", emoji: "🤝" },
  charm: { label: "Charm", emoji: "💘" },
  scen: { label: "Scenen", emoji: "🎤" },
  fys: { label: "Styrka & mod", emoji: "💪" },
  dryck: { label: "Dryckesmästarn", emoji: "🍺" },
};

export const TIER_ORDER: Tier[] = ["wood", "bronze", "silver", "gold", "diamond"];

/**
 * Modern spelkortslook: vita kortytor med skarpa hörn och tunna ramar i
 * tier-färgen — metallidentiteten (trä/brons/silver/guld/diamant) sitter i
 * ramen och detaljerna, inte i pergament-bakgrunder.
 */
export const TIERS: Record<
  Tier,
  { label: string; symbol: string; frame: string; frameDark: string; face: string; text: string }
> = {
  wood: { label: "Trä", symbol: "🪵", frame: "#8B6F47", frameDark: "#5D4A2F", face: "#FFFFFF", text: "#15151B" },
  bronze: { label: "Brons", symbol: "🥉", frame: "#B87333", frameDark: "#7C4A1E", face: "#FFFFFF", text: "#15151B" },
  silver: { label: "Silver", symbol: "🥈", frame: "#9AA3AD", frameDark: "#6D7681", face: "#FFFFFF", text: "#15151B" },
  gold: { label: "Guld", symbol: "🏆", frame: "#D4AF37", frameDark: "#96781F", face: "#FFFFFF", text: "#15151B" },
  diamond: { label: "Diamant", symbol: "💎", frame: "#3D5AFE", frameDark: "#2A3EB1", face: "#FFFFFF", text: "#15151B" },
};

export type HuntChallenge = {
  id: number;
  name: string;
  tier: Tier;
  category: Category;
  points: number;
  bonus_points: number | null;
  bonus_condition: string | null;
  description: string;
  background_theme: string;
  requires_alcohol: boolean;
};

export type HuntCompletion = {
  id: string;
  challenge_id: number;
  user_id: string;
  group_id: string;
  witness_user_id: string;
  bonus_claimed: boolean;
  status: "pending" | "confirmed" | "denied";
  points_awarded: number;
  proof_url: string | null;
  created_at: string;
};

export function isVideoPath(path: string): boolean {
  return /\.(mp4|mov|webm|m4v)$/i.test(path);
}
