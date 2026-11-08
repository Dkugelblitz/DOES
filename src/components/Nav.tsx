import Link from "next/link";
import { signOut } from "@/app/auth/actions";

export function Nav({ current, isAdmin }: { current: "home" | "roadmap"; isAdmin?: boolean }) {
  const link = (href: string, key: typeof current, label: string) => (
    <Link href={href} className={`nav-link${current === key ? " on" : ""}`} aria-current={current === key ? "page" : undefined}>{label}</Link>
  );
  return (
    <nav className="nav" aria-label="Main">
      <span className="brand">🎯 DEOS</span>
      {link("/", "home", "Home")}
      {link("/roadmap", "roadmap", "Roadmap")}
      {isAdmin && <span className="muted">Admin</span>}
      <form action={signOut} style={{ marginLeft: "auto" }}><button className="btn" type="submit">Sign out</button></form>
    </nav>
  );
}
