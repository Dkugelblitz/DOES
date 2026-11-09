import Link from "next/link";
import { signOut } from "@/app/auth/actions";

type Section = "home" | "roadmap" | "pareto" | "sprint" | "insights" | "account" | "admin";

export function Nav({ current, isAdmin }: { current: Section; isAdmin?: boolean }) {
  const link = (href: string, key: Section, label: string) => (
    <Link href={href} className={`nav-link${current === key ? " on" : ""}`} aria-current={current === key ? "page" : undefined}>{label}</Link>
  );
  return (
    <nav className="nav" aria-label="Main">
      <span className="brand">🎯 DEOS</span>
      {link("/", "home", "Home")}
      {link("/roadmap", "roadmap", "Roadmap")}
      {link("/pareto", "pareto", "Pareto")}
      {link("/sprint/plan", "sprint", "Sprint")}
      {link("/insights", "insights", "Insights")}
      {link("/account", "account", "Account")}
      {isAdmin && link("/admin", "admin", "Admin")}
      <form action={signOut} style={{ marginLeft: "auto" }}><button className="btn" type="submit">Sign out</button></form>
    </nav>
  );
}
