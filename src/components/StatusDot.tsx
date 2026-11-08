"use client";
import { useOptimistic, useTransition } from "react";
import { setTopicStatus } from "@/app/progress-actions";

const LABEL = ["Not started", "In progress", "Done"] as const;
const MARK = ["", "…", "✓"] as const;

/** Cycles a topic's status: not started → in progress → done → not started. */
export function StatusDot({ topicId, topicName, status }: { topicId: string; topicName: string; status: number }) {
  const [optimistic, setOptimistic] = useOptimistic(status);
  const [pending, start] = useTransition();
  const next = (optimistic + 1) % 3;
  return (
    <button
      type="button"
      className={`dot s${optimistic}`}
      aria-label={`${topicName}: ${LABEL[optimistic]}. Mark as ${LABEL[next].toLowerCase()}.`}
      aria-busy={pending}
      onClick={() => start(async () => { setOptimistic(next); await setTopicStatus(topicId, next); })}
    >
      <span aria-hidden="true">{MARK[optimistic]}</span>
    </button>
  );
}
