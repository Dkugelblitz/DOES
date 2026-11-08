import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./OnboardingForm";

export default async function OnboardingPage() {
  const access = await getAccess();
  if (!access) redirect("/sign-in");
  if (access.onboarded) redirect("/");
  const supabase = await createClient();
  const [{ data: levels }, { data: profile }] = await Promise.all([
    supabase.from("levels").select("level, name, icon, description").order("level"),
    supabase.from("profiles").select("display_name").eq("id", access.user_id).single(),
  ]);
  return (
    <main style={{ maxWidth: 560 }}>
      <h1>Welcome to DEOS 👋</h1>
      <p className="muted">One quick choice and you&apos;re in.</p>
      <div className="card">
        <OnboardingForm levels={levels ?? []} defaultName={profile?.display_name ?? ""} />
      </div>
    </main>
  );
}
