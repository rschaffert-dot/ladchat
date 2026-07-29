import type { AppIconName } from "@/components/AppIcon";

/**
 * Trofékod → linjeikon. Speglar public.achievements i
 * supabase/migrations/0017_achievements_energy.sql.
 *
 * Tabellen har en emoji-kolumn kvar, men klienten visar ikoner i stället —
 * kolumnen används inte längre för visning.
 */
export const ACHIEVEMENT_ICONS: Record<string, AppIconName> = {
  first_reaction: "strength",
  points_100: "star",
  points_500: "trophy",
  level_legend: "crown",
  streak_7: "fire",
  duel_winner: "swords",
  quest_master: "target",
};

/** Okända koder (t.ex. nya troféer som ännu inte fått ikon) får en generisk. */
export function achievementIcon(code: string): AppIconName {
  return ACHIEVEMENT_ICONS[code] ?? "award";
}
