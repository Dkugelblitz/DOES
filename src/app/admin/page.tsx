import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

type Overview = { users: number; active_7d: number; admins: number; disabled: number; pending_requests: number; open_invites: number; by_level: Record<string, number> };

export default async function AdminOverview() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data }, { data: levels }] = await Promise.all([
    supabase.rpc("admin_overview"),
    supabase.from("levels").select("level, name, icon").order("level"),
  ]);
  const o = data as Overview | null;
  if (!o) return <p className="error">Couldn&apos;t load the overview.</p>;
  const tiles: [string, number, string?][] = [
    ["users", o.users, "/admin/users"], ["active in the last 7 days", o.active_7d], ["pending level requests", o.pending_requests, "/admin/requests"],
    ["admins", o.admins], ["disabled accounts", o.disabled], ["open invites", o.open_invites, "/admin/import"],
  ];
  return (
    <>
      <div className="grid-tiles">
        {tiles.map(([label, n, href]) => {
          const body = <><b>{n}</b><span>{label}</span></>;
          return href ? <Link key={label} href={href} className="tile">{body}</Link> : <div key={label} className="tile">{body}</div>;
        })}
      </div>
      <h2>Users by level</h2>
      <div className="card">
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {(levels ?? []).map((l) => <li key={l.level}>{l.icon} {l.name}: <strong>{o.by_level[String(l.level)] ?? 0}</strong></li>)}
        </ul>
        <p className="muted" style={{ marginBottom: 0 }}>Counts granted levels. Admins hold every level automatically and are counted only for levels granted to them.</p>
      </div>
      <p className="muted">Full analytics (study time, completion and revision rates) arrive with the final milestone.</p>
    </>
  );
}
