import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { SignInForm } from "./SignInForm";
import { safeNext } from "@/lib/next-path";

const ERRORS: Record<string, string> = {
  google: "Google sign-in didn't start. Please try again.",
  callback: "That sign-in link didn't work. Please try again.",
  confirm: "That confirmation link is invalid or has expired. Sign in to get a new one.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; reauth?: string }> }) {
  const { error, next, reauth } = await searchParams;
  const dest = safeNext(next);
  if (await getAccess()) redirect(dest);
  return (
    <main style={{ maxWidth: 440 }}>
      <h1>🎯 DEOS</h1>
      <p className="muted">Interview prep for Data Engineers, Principal Data Engineers and Data Architects.</p>
      {reauth && <p className="card" role="status">For your security, please sign in again to confirm that change. You&apos;ll go straight back to where you were.</p>}
      <div className="card">
        <SignInForm initialError={error ? ERRORS[error] : undefined} next={dest} />
      </div>
    </main>
  );
}
