"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const TABS = [["plan", "Plan"], ["cards", "Flip cards"], ["designs", "Designs"], ["hackerrank", "HackerRank AI"]] as const;

/** Section tabs; keeps the chosen ?level= when moving between them. */
export function SprintTabs() {
  const path = usePathname();
  const level = useSearchParams().get("level");
  const q = level && /^[123]$/.test(level) ? `?level=${level}` : "";
  return (
    <nav className="tabs" aria-label="Sprint sections">
      {TABS.map(([slug, label]) => {
        const href = `/sprint/${slug}`, on = path === href;
        return <Link key={slug} href={href + q} className={`tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>{label}</Link>;
      })}
    </nav>
  );
}
