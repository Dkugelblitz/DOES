// Level maths (mirrors public.my_game). Pure, no imports.
// level = min(max_level, floor(sqrt(xp / divisor)) + 1). With divisor 40 and 7 levels,
// level L starts at 40 * (L-1)^2 XP: 0, 40, 160, 360, 640, 1000, 1440.

export type LevelCfg = { divisor: number; max_level: number; titles: { level: number; title: string }[] };
export type LevelInfo = { level: number; title: string; floorXp: number; nextXp: number | null; progress: number; nextTitle: string | null };

export function levelInfo(xp: number, cfg: LevelCfg): LevelInfo {
  const x = Math.max(0, Math.floor(xp));
  const level = Math.min(cfg.max_level, Math.floor(Math.sqrt(x / cfg.divisor)) + 1);
  const floorXp = cfg.divisor * (level - 1) ** 2;
  const nextXp = level >= cfg.max_level ? null : cfg.divisor * level ** 2;
  const title = (l: number) => cfg.titles.find((t) => t.level === l)?.title ?? null;
  return {
    level, title: title(level) ?? `Level ${level}`, floorXp, nextXp,
    progress: nextXp === null ? 1 : (x - floorXp) / (nextXp - floorXp),
    nextTitle: nextXp === null ? null : title(level + 1),
  };
}

/** Plain-English description of a badge rule, for the badges page. */
export function describeRule(rule: { type: string; gte?: number; from?: number; to?: number }): string {
  const h = (n: number) => (n === 0 ? "midnight" : n === 12 ? "noon" : n < 12 ? `${n} am` : `${n - 12} pm`);
  switch (rule.type) {
    case "topics_done": return rule.gte === 1 ? "Finish your first topic" : `Finish ${rule.gte} topics`;
    case "streak_days": return `Study ${rule.gte} days in a row`;
    case "study_minutes": return `Study for ${Math.round((rule.gte ?? 0) / 60)} hours in total`;
    case "notes_count": return `Write notes on ${rule.gte} topics`;
    case "revisions_count": return `Revise ${rule.gte} topics when they're due`;
    case "pareto_complete": return "Finish every Pareto core topic for one of your levels";
    case "session_start_local_hour": return `Start a study session between ${h(rule.from ?? 0)} and ${h(rule.to ?? 0)}`;
    default: return "A special achievement";
  }
}
