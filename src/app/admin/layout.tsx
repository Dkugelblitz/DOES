import { requireAdmin } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/Nav";
import { AdminTabs } from "./AdminTabs";

// Every /admin page re-checks is_admin in the database on each request (403 otherwise).
// The database functions behind each page check again, so this is not the only protection.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAdmin();
  const supabase = await createClient();
  const { count } = await supabase.from("level_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
  return (
    <main className="wide">
      <Nav current="admin" isAdmin={access.is_admin} />
      <h1>Admin</h1>
      <AdminTabs pending={count ?? 0} />
      {children}
    </main>
  );
}
