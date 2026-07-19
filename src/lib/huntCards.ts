import { Platform } from "react-native";

/**
 * Delad kortdata för Poängjakten: tier-/kategoriutseende och domäntyper.
 * Används av jaktvyn (src/app/hunt) och LadBook på profilen, så korten
 * ser likadana ut överallt.
 */

export const HUNT_SERIF = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "Georgia",
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

export const TIERS: Record<
  Tier,
  { label: string; symbol: string; frame: string; frameDark: string; face: string; text: string }
> = {
  wood: { label: "Trä", symbol: "🪵", frame: "#8a5a2b", frameDark: "#5d3c1c", face: "#efe0bd", text: "#4a3418" },
  bronze: { label: "Brons", symbol: "🥉", frame: "#b87333", frameDark: "#7c4a1e", face: "#f0ddba", text: "#5a3517" },
  silver: { label: "Silver", symbol: "🥈", frame: "#aab4bf", frameDark: "#6d7681", face: "#eef0ef", text: "#3c434b" },
  gold: { label: "Guld", symbol: "🏆", frame: "#d4af37", frameDark: "#96781f", face: "#f5e9c0", text: "#5c4a12" },
  diamond: { label: "Diamant", symbol: "💎", frame: "#8fd8f2", frameDark: "#4d94ad", face: "#e8f6fb", text: "#1f4b5a" },
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
