import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { ago, fmtDate, LEVEL_SHORT } from "@/lib/format";
import { BulkGrantForm } from "./BulkGrantForm";

type Row = {
  id: string; email: string; display_name: string | null; created_at: string; last_active_at: string | null;
  disabled: boolean; is_admin: boolean; granted: number[]; active_level: number | null; xp: number; streak: number; topics_done: number;
};
const PAGE = 25;

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requireAdmin();
  const { q = "", page = "1" } = await searchParams;
  const p = Math.max(1, Math.min(10_000, parseInt(page, 10) || 1));
  const search = q.trim().slice(0, 100);
  const supabase = await createClient();
  const [{ data, error }, { data: levels }] = await Promise.all([
    supabase.rpc("admin_list_users", { p_search: search || null, p_limit: PAGE, p_offset: (p - 1) * PAGE }),
    supabase.from("levels").select("level, name").order("level"),
  ]);
  if (error) return <p className="error">Couldn&apos;t load users: {error.message}</p>;
  const { total, users } = data as { total: number; users: Row[] };
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const href = (n: number) => `/admin/users?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(n) })}`;

  return (
    <>
      <form className="row" role="search" action="/admin/users">
        <label className="sr-only" htmlFor="q">Search users</label>
        <input id="q" name="q" defaultValue={search} placeholder="Search by name or email" style={{ flex: 1, minWidth: 200 }} />
        <button className="btn" type="submit">Search</button>
        {search && <Link className="btn" href="/admin/users">Clear</Link>}
      </form>
      <p className="muted">{total} user{total === 1 ? "" : "s"}{search && <> matching “{search}”</>}</p>

      <BulkGrantForm levels={levels ?? []}>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Users</caption>
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Select</span></th>
                <th scope="col">User</th><th scope="col">Levels</th><th scope="col">Signed up</th><th scope="col">Last active</th>
                <th scope="col" className="num">XP</th><th scope="col" className="num">Streak</th><th scope="col" className="num">Topics done</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.disabled ? "dim" : undefined}>
                  <td><input type="checkbox" name="ids" value={u.id} aria-label={`Select ${u.email}`} /></td>
                  <td>
                    <Link href={`/admin/users/${u.id}`}><strong>{u.display_name || u.email.split("@")[0]}</strong></Link>
                    <div className="muted">{u.email}</div>
                    <div className="row" style={{ gap: 4 }}>
                      {u.is_admin && <span className="tag core">Admin</span>}
                      {u.disabled && <span className="tag">Disabled</span>}
                    </div>
                  </td>
                  <td>{u.granted.length ? u.granted.map((l) => <span key={l} className={`tag${l === u.active_level ? " core" : ""}`} title={l === u.active_level ? "Default level" : undefined}>{LEVEL_SHORT[l]}</span>) : <span className="muted">none yet</span>}</td>
                  <td>{fmtDate(u.created_at)}</td>
                  <td>{ago(u.last_active_at)}</td>
                  <td className="num">{u.xp}</td><td className="num">{u.streak}</td><td className="num">{u.topics_done}</td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan={8} className="muted">No users found.</td></tr>}
            </tbody>
          </table>
        </div>
      </BulkGrantForm>

      {pages > 1 && (
        <nav className="row" aria-label="Pages" style={{ marginTop: 12 }}>
          {p > 1 && <Link className="btn" href={href(p - 1)}>← Previous</Link>}
          <span className="muted">Page {p} of {pages}</span>
          {p < pages && <Link className="btn" href={href(p + 1)}>Next →</Link>}
        </nav>
      )}
      <p className="muted">Levels: DE = Data Engineer, PDE = Principal Data Engineer, DA = Data Architect. The highlighted one is the user&apos;s default level.</p>
    </>
  );
}
