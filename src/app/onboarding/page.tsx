import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./OnboardingForm";

export default async function OnboardingPage() {
  const access = await getAccess();
  if (!access) redirect("/sign-in");
  if (access.onboarded) redirect("/");
  const supabase = await createClient();
  const [{ data: levels }, { data: profile }, { data: invite }, { data: grants }] = await Promise.all([
    supabase.from("levels").select("level, name, icon, description").order("level"),
    supabase.from("profiles").select("display_name").eq("id", access.user_id).single(),
    supabase.rpc("my_invite"),
    supabase.from("level_grants").select("level").eq("user_id", access.user_id).is("revoked_at", null),
  ]);
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
