/** Speglar level_for_points/title_for_level i supabase/migrations/0011_points_engine.sql. */

export const LEVELS = [
  { level: 1, title: "Ynkrygg", min: 0 },
  { level: 2, title: "Lärling", min: 50 },
  { level: 3, title: "Grabb", min: 150 },
  { level: 4, title: "Alfa", min: 350 },
  { level: 5, title: "Legend", min: 700 },
] as const;

export function levelForPoints(points: number): number {
  let lvl = 1;
  for (const l of LEVELS) if (points >= l.min) lvl = l.level;
  return lvl;
}

export function titleForLevel(level: number): string {
  return LEVELS.find((l) => l.level === level)?.title ?? "Ynkrygg";
}

export function titleForPoints(points: number): string {
  return titleForLevel(levelForPoints(points));
}

/** Progress mot nästa level som 0–1 (1 om max-level). */
export function progressForPoints(points: number): {
  current: (typeof LEVELS)[number];
  next: (typeof LEVELS)[number] | null;
  progress: number;
} {
  const lvl = levelForPoints(points);
  const current = LEVELS[lvl - 1];
  const next = lvl < LEVELS.length ? LEVELS[lvl] : null;
  const progress = next
    ? Math.min(1, (points - current.min) / (next.min - current.min))
    : 1;
  return { current, next, progress };
}
