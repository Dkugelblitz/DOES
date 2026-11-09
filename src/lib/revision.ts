// Spaced-revision rule (mirrors private.due_topics in the database). Pure, no imports.

export type RevisionState = "not_done" | "fresh" | "due" | "overdue";
export type Revision = { state: RevisionState; days: number; dueInDays: number };

export function revisionState(opts: {
  status: number; doneAt: string | null; lastRevisedAt: string | null; now?: Date; due?: number; overdue?: number;
}): Revision {
  const due = opts.due ?? 5, overdue = opts.overdue ?? 7;
  if (opts.status !== 2 || !opts.doneAt) return { state: "not_done", days: 0, dueInDays: due };
  const start = Math.max(Date.parse(opts.doneAt), opts.lastRevisedAt ? Date.parse(opts.lastRevisedAt) : 0);
  const days = Math.max(0, Math.floor(((opts.now ?? new Date()).getTime() - start) / 86_400_000));
  return { state: days >= overdue ? "overdue" : days >= due ? "due" : "fresh", days, dueInDays: Math.max(0, due - days) };
}
