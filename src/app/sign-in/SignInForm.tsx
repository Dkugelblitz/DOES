"use client";
import { useActionState, useState } from "react";
import { signInWithGoogle, signInWithPassword, signUpWithPassword, type AuthState } from "@/app/auth/actions";

export function SignInForm({ initialError }: { initialError?: string }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [inState, signIn, signingIn] = useActionState<AuthState, FormData>(signInWithPassword, {});
  const [upState, signUp, signingUp] = useActionState<AuthState, FormData>(signUpWithPassword, {});
  const state = mode === "in" ? inState : upState;
  const pending = signingIn || signingUp;
  const error = state.error ?? initialError;

  return (
    <div className="stack">
      <form action={signInWithGoogle}>
        <button className="btn" type="submit" style={{ width: "100%" }}>
          <span aria-hidden="true">G</span> Continue with Google
        </button>
      </form>
      <div className="divider">or use email</div>
      <form action={mode === "in" ? signIn : signUp} className="stack" noValidate>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" minLength={8} required
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            aria-describedby="pw-hint" />
          <span id="pw-hint" className="muted">At least 8 characters.</span>
        </label>
        <div role="status" aria-live="polite">
          {error && <p className="error">{error}</p>}
          {state.info && <p className="ok">{state.info}</p>}
        </div>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}
        </button>
      </form>
      <p className="muted">
        {mode === "in" ? "New here? " : "Already have an account? "}
        <button type="button" className="btn" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "Create an account" : "Sign in instead"}
        </button>
      </p>
    </div>
  );
}
