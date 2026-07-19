import type { ReactionKey } from "@/lib/types";

/** Speglar public.reaction_points i supabase/migrations/0012_reactions.sql. */
export const REACTIONS: Record<ReactionKey, { emoji: string; label: string; points: number }> = {
  respekt: { emoji: "💪", label: "Respekt", points: 3 },
  skal: { emoji: "🍺", label: "Skål", points: 2 },
  eld: { emoji: "🔥", label: "Eld", points: 2 },
  get: { emoji: "🐐", label: "GOAT", points: 5 },
  skalle: { emoji: "💀", label: "Död", points: 1 },
};

export const REACTION_ORDER: ReactionKey[] = ["respekt", "skal", "eld", "get", "skalle"];
