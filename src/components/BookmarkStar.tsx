"use client";
import { useOptimistic, useTransition } from "react";
import { setBookmark } from "@/app/revision/actions";

export function BookmarkStar({ topicId, topicName, on }: { topicId: string; topicName: string; on: boolean }) {
  const [state, setState] = useOptimistic(on);
  const [, start] = useTransition();
  return (
    <button type="button" className={`star${state ? " on" : ""}`} aria-pressed={state}
      aria-label={state ? `Remove ${topicName} from bookmarks` : `Bookmark ${topicName} for revision`}
      title={state ? "Bookmarked" : "Bookmark for revision"}
      onClick={() => start(async () => { setState(!state); await setBookmark(topicId, !state); })}>
      <span aria-hidden="true">{state ? "★" : "☆"}</span>
    </button>
  );
}
