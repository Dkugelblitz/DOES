import { redirect } from "next/navigation";
import { getSession } from "@/lib/access";
import { signOut } from "@/app/auth/actions";

export default async function DisabledPage() {
  const { user, access } = await getSession();
  if (!user) redirect("/sign-in");
  if (access) redirect("/");
  return (
    <main style={{ maxWidth: 520 }}>
      <h1>Your account is paused</h1>
      <p>An admin has disabled this account, so you can&apos;t use DEOS right now. Your progress and notes are kept safe.
        If you think this is a mistake, contact the person who runs your DEOS.</p>
      <form action={signOut}><button className="btn" type="submit">Sign out</button></form>
    </main>
  );
}
