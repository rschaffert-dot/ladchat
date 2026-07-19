import type { BeerGlassSize } from "@/lib/types";

/** Speglar public.beer_glass_capacity/points i supabase/migrations/0004_beer_mode.sql. */
export const BEER_GLASSES: Record<
  BeerGlassSize,
  { label: string; capacityCl: number; points: number }
> = {
  galopp: { label: "Galopp", capacityCl: 33, points: 33 },
  storstark: { label: "Stor stark", capacityCl: 40, points: 50 },
  slaktarbagare: { label: "Slaktarbägare", capacityCl: 100, points: 150 },
};

/** Speglar public.beer_duration_bonus i supabase/migrations/0005_beer_mode_timer.sql. */
export const BEER_DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 105, 120];

export const BEER_DURATION_BONUS: Record<number, number> = {
  15: 25,
  30: 12,
  45: 8,
  60: 5,
  75: 4,
  90: 3,
  105: 2,
  120: 1,
};
