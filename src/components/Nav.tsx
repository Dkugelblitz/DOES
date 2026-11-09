import Link from "next/link";
import { cookies } from "next/headers";
import { signOut } from "@/app/auth/actions";
import { ThemeToggle } from "@/components/ThemeToggle";

type Section = "home" | "roadmap" | "pareto" | "sprint" | "insights" | "account" | "admin";

export async function Nav({ current, isAdmin }: { current: Section; isAdmin?: boolean }) {
  const t = (await cookies()).get("theme")?.value;
  const theme = t === "light" || t === "dark" ? t : "system";
  const link = (href: string, key: Section, label: string) => (
    <Link href={href} className={`nav-link${current === key ? " on" : ""}`} aria-current={current === key ? "page" : undefined}>{label}</Link>
  );
  return (
    <>
    <nav className="nav" aria-label="Main">
      <span className="brand">🎯 DEOS</span>
      {link("/", "home", "Home")}
      {link("/roadmap", "roadmap", "Roadmap")}
      {link("/pareto", "pareto", "Pareto")}
      {link("/sprint/plan", "sprint", "Sprint")}
      {link("/insights", "insights", "Insights")}
      {link("/account", "account", "Account")}
      {isAdmin && link("/admin", "admin", "Admin")}
      <span className="row" style={{ marginLeft: "auto", gap: 6 }}>
        <ThemeToggle initial={theme} />
        <form action={signOut}><button className="btn" type="submit">Sign out</button></form>
      </span>
    </nav>
    <span id="content" tabIndex={-1} />
    </>
  );
}
