import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./OnboardingForm";
import { WaitingRoom } from "./WaitingRoom";
import { signOut } from "@/app/auth/actions";

export default async function OnboardingPage() {
  const access = await getAccess();
  if (!access) redirect("/sign-in");
  if (access.onboarded) redirect("/");
  const supabase = await createClient();
  const [{ data: levels }, { data: profile }, { data: invite }, { data: grants }, { data: join }] = await Promise.all([
    supabase.from("levels").select("level, name, icon, description").order("level"),
    supabase.from("profiles").select("display_name").eq("id", access.user_id).single(),
    supabase.rpc("my_invite"),
    supabase.from("level_grants").select("level").eq("user_id", access.user_id).is("revoked_at", null),
    supabase.rpc("my_join_status"),
  ]);
  const status = join as { allowed: boolean; reason: string; pending_requests: number[] } | null;
  if (status && !status.allowed) {
    return (
      <main style={{ maxWidth: 560 }}>
        <h1>DEOS is invite-only 👋</h1>
        <p className="muted">Thanks for signing in{profile?.display_name ? `, ${profile.display_name.split(" ")[0]}` : ""}. An admin decides who can join. Ask for access below and you&apos;ll be let in as soon as it&apos;s approved.</p>
        <div className="card">
          <WaitingRoom levels={levels ?? []} pending={status.pending_requests} />
        </div>
        <form action={signOut}><button className="btn" type="submit">Sign out</button></form>
      </main>
    );
  }
  // Levels given in advance (CSV import, or granted by an admin before first sign-in) replace the picker.
  const given = [...new Set([...((invite as number[] | null) ?? []), ...(grants ?? []).map((g) => g.level as number)])].sort();
  return (
    <main style={{ maxWidth: 560 }}>
      <h1>Welcome to DEOS 👋</h1>
      <p className="muted">One quick choice and you&apos;re in.</p>
      <div className="card">
        <OnboardingForm levels={levels ?? []} defaultName={profile?.display_name ?? ""} given={given} />
      </div>
    </main>
  );
}
