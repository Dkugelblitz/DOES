import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyUnsubscribe } from "@/lib/reminders/token";

// Public page (no sign-in needed). Opening the link only shows a button: some mail scanners
// open every link, so the change happens on the button press (a POST), not on page load.
async function unsubscribe(form: FormData) {
  "use server";
  const u = String(form.get("u") ?? ""), t = String(form.get("t") ?? "");
  const secret = process.env.REMINDER_SECRET ?? "";
  if (!verifyUnsubscribe(u, t, secret)) return;
  await createServiceClient().rpc("set_email_reminders_for", { p_user: u, p_on: false });
  redirect("/unsubscribe?done=1");
}

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ u?: string; t?: string; done?: string }> }) {
  const { u = "", t = "", done } = await searchParams;
  const valid = verifyUnsubscribe(u, t, process.env.REMINDER_SECRET ?? "");
  return (
    <main style={{ maxWidth: 520 }}>
      <h1>🎯 DEOS reminders</h1>
      {done ? (
        <p className="card" role="status">Done. You won&apos;t get revision reminder emails any more. You can turn them back on from your Account page whenever you like.</p>
      ) : valid ? (
        <form action={unsubscribe} className="card stack">
          <p style={{ margin: 0 }}>Stop the daily revision reminder emails? Your revision list stays on your home page.</p>
          <input type="hidden" name="u" value={u} /><input type="hidden" name="t" value={t} />
          <div><button className="btn primary" type="submit">Turn off reminder emails</button></div>
        </form>
      ) : (
        <p className="card">This link isn&apos;t valid. You can turn reminders off from your Account page after signing in.</p>
      )}
    </main>
  );
}
