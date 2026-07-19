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
