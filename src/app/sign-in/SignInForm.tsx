"use client";
import { useFormStatus } from "react-dom";
import { signInWithGoogle } from "@/app/auth/actions";

function GoogleButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn primary" type="submit" disabled={pending} style={{ width: "100%" }}>
      {pending ? "Opening Google…" : <><span aria-hidden="true">G</span>&nbsp;Continue with Google</>}
    </button>
  );
}

export function SignInForm({ initialError, next = "/" }: { initialError?: string; next?: string }) {
  return (
    <div className="stack">
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <GoogleButton />
      </form>
      <div role="status" aria-live="polite">{initialError && <p className="error" style={{ margin: 0 }}>{initialError}</p>}</div>
      <p className="muted" style={{ margin: 0 }}>
        New here? Signing in with Google creates your account. We only use your name and email address.
      </p>
    </div>
  );
}
