"use client";
import { useEffect, useState } from "react";

type Toast = { id: number; text: string };
const EVENT = "deos:toast";

/** Show one or more short messages (cheers, XP, badges). Safe to call from any client component. */
export function toast(lines: string[] | undefined) {
  if (!lines?.length || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: lines }));
}

/** Mounted once in the root layout. Announces politely to screen readers; respects reduced motion. */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const lines = (e as CustomEvent<string[]>).detail;
      const added = lines.map((text) => ({ id: ++n + Date.now(), text }));
      setItems((xs) => [...xs, ...added].slice(-4));
      for (const t of added) setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 4500);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.text}</span>
          <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>×</button>
        </div>
      ))}
    </div>
  );
}
