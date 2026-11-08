import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { SignInForm } from "./SignInForm";

const ERRORS: Record<string, string> = {
  google: "Google sign-in didn't start. Please try again.",
  callback: "That sign-in link didn't work. Please try again.",
  confirm: "That confirmation link is invalid or has expired. Sign in to get a new one.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getAccess()) redirect("/");
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 440 }}>
      <h1>🎯 DEOS</h1>
      <p className="muted">Interview prep for Data Engineers, Principal Data Engineers and Data Architects.</p>
      <div className="card">
        <SignInForm initialError={error ? ERRORS[error] : undefined} />
      </div>
    </main>
  );
}
