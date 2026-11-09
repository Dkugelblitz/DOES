import Link from "next/link";

/** One tab per level the user holds. Hidden when only one level is held. */
export function LevelTabs({ held, current, base, label }: { held: { level: number; name: string; icon: string }[]; current: number; base: string; label: string }) {
  if (held.length < 2) return null;
  return (
    <nav className="tabs" aria-label={label}>
      {held.map((l) => (
        <Link key={l.level} href={`${base}?level=${l.level}`} className={`tab${l.level === current ? " on" : ""}`} aria-current={l.level === current ? "page" : undefined}>
          {l.icon} {l.name}
        </Link>
      ))}
    </nav>
  );
}
