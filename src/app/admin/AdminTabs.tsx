"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["/admin", "Overview"],
  ["/admin/users", "Users"],
  ["/admin/requests", "Requests"],
  ["/admin/import", "Import"],
  ["/admin/analytics", "Analytics"],
  ["/admin/content", "Content"],
  ["/admin/audit", "Audit log"],
] as const;

export function AdminTabs({ pending }: { pending: number }) {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Admin">
      {TABS.map(([href, label]) => {
        const on = href === "/admin" ? path === "/admin" : path.startsWith(href);
        return (
          <Link key={href} href={href} className={`tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
            {label}{href === "/admin/requests" && pending > 0 && <span className="badge" aria-label={`${pending} pending`}>{pending}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
