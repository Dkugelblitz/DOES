// Pure progress maths: readiness, ETA and pace. No imports, so it runs in the app,
// on the server and directly in Node tests.

export type Status = 0 | 1 | 2; // not started, in progress, done

export type Readiness = { total: number; done: number; inProgress: number; notStarted: number; pct: number };

/** Done counts 1, in progress counts `inProgressWeight` (0.4 by default). */
export function readiness(statuses: Status[], inProgressWeight = 0.4): Readiness {
  let done = 0, inProgress = 0;
  for (const s of statuses) { if (s === 2) done++; else if (s === 1) inProgress++; }
  const total = statuses.length;
  const pct = total ? Math.round(((done + inProgress * inProgressWeight) / total) * 100) : 0;
  return { total, done, inProgress, notStarted: total - done - inProgress, pct };
}

/** Calendar date (YYYY-MM-DD) of `now` in an IANA time zone. Falls back to UTC for unknown zones. */
export function localDate(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Whole days from today (in the user's zone) to an ISO date. Tomorrow = 1, today = 0, past < 0. */
export function daysUntil(isoDate: string, now: Date, timeZone: string): number {
  const today = Date.parse(localDate(now, timeZone) + "T00:00:00Z");
  const target = Date.parse(isoDate.slice(0, 10) + "T00:00:00Z");
  return Math.round((target - today) / 86_400_000);
}

export type PaceStatus = "complete" | "no_date" | "today" | "passed" | "on_track" | "behind";

export type Eta = {
  remainingTopics: number;   // weighted: in-progress topics count as partly done
  hoursRemaining: number;
  daysAtCurrentPace: number; // at the user's hours per day
  daysToInterview: number | null;
  hoursPerDayNeeded: number | null;
  status: PaceStatus;
};

export function eta(opts: {
  readiness: Readiness;
  hoursPerTopic: number;
  hoursPerDay: number;
  inProgressWeight?: number;
  interviewDate?: string | null;
  now?: Date;
  timeZone?: string;
}): Eta {
  const w = opts.inProgressWeight ?? 0.4;
  const r = opts.readiness;
  const remainingTopics = Math.max(0, r.total - r.done - r.inProgress * w);
  const hoursRemaining = Math.max(0, remainingTopics * opts.hoursPerTopic);
  const hpd = Math.max(0.5, opts.hoursPerDay);
  const daysAtCurrentPace = Math.ceil(hoursRemaining / hpd - 1e-9);
  const daysToInterview = opts.interviewDate ? daysUntil(opts.interviewDate, opts.now ?? new Date(), opts.timeZone ?? "UTC") : null;

  let status: PaceStatus, hoursPerDayNeeded: number | null = null;
  if (hoursRemaining <= 0) status = "complete";
  else if (daysToInterview === null) status = "no_date";
  else if (daysToInterview < 0) status = "passed";
  else if (daysToInterview === 0) status = "today";
  else {
    hoursPerDayNeeded = Math.round((hoursRemaining / daysToInterview) * 10) / 10;
    status = hoursPerDayNeeded <= hpd ? "on_track" : "behind";
  }
  return { remainingTopics, hoursRemaining, daysAtCurrentPace, daysToInterview, hoursPerDayNeeded, status };
}
