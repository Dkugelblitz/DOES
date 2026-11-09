// Encouragement text. All wording lives in the "messages" content document (editable by
// admins); these helpers only pick and fill templates. Pure, no imports.

export type Messages = {
  time_of_day: { before_hour: number; text: string }[];
  greeting: Record<"headline" | "streak_active" | "streak_none" | "revisions_due_one" | "revisions_due_many" | "next_topic" | "all_touched" | "footer", string>;
  topic_done_cheers: string[];
  closing: { summary_with_minutes: string; summary_no_minutes: string; totals: string; farewells: string[] };
  toasts: Record<string, string>;
};

/** Replace {name} placeholders. Unknown placeholders are left empty. */
export function fill(tpl: string | undefined, vars: Record<string, string | number>): string {
  return (tpl ?? "").replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ""));
}

export function pick<T>(list: T[] | undefined, seed = Math.random()): T | undefined {
  return list?.length ? list[Math.floor(seed * list.length) % list.length] : undefined;
}

export function timeOfDay(m: Messages, hour: number): string {
  return [...(m.time_of_day ?? [])].sort((a, b) => a.before_hour - b.before_hour).find((t) => hour < t.before_hour)?.text ?? "Hello";
}

/** Local hour (0-23) in an IANA time zone; falls back to UTC. */
export function localHour(now: Date, timeZone: string): number {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(now)) % 24;
  } catch {
    return now.getUTCHours();
  }
}

export type GreetingInput = { name: string | null; hour: number; streak: number; dueCount: number; nextTopic: string | null; levelName: string };

/** The sign-in greeting: time of day, name, streak, revisions due, next suggested topic. */
export function greeting(m: Messages, g: GreetingInput): { headline: string; lines: string[]; footer: string } {
  const first = g.name?.trim().split(/\s+/)[0];
  const lines = [
    g.streak > 0 ? fill(m.greeting.streak_active, { streak: g.streak }) : m.greeting.streak_none,
    ...(g.dueCount === 1 ? [m.greeting.revisions_due_one] : g.dueCount > 1 ? [fill(m.greeting.revisions_due_many, { count: g.dueCount })] : []),
    g.nextTopic ? fill(m.greeting.next_topic, { topic: g.nextTopic }) : m.greeting.all_touched,
  ].filter(Boolean);
  return {
    headline: fill(m.greeting.headline, { time_of_day: timeOfDay(m, g.hour), name_suffix: first ? `, ${first}` : "" }),
    lines,
    footer: fill(m.greeting.footer, { level_name: g.levelName }),
  };
}
