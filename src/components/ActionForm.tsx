"use client";
import { useActionState, useEffect, useState } from "react";
import { reauthenticate } from "@/app/auth/actions";

type Result = { ok?: string; error?: string; reauth?: boolean };

/**
 * A form bound to a server action, with a status line. With `confirm`, the first click arms the
 * button and a second click submits (used for revoking, demoting and disabling). If the action
 * asks for re-authentication, offers a "Sign in again" button that returns to `next`.
 */
export function ActionForm({ action, children, submit, confirm, danger, next, inline }: {
  action: (state: Result, form: FormData) => Promise<Result>;
  children?: React.ReactNode;
  submit: string;
  confirm?: string;
  danger?: boolean;
  next?: string;
  inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState<Result, FormData>(action, {});
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (state.ok || state.error) setArmed(false); }, [state]);
  const cls = danger ? "btn danger" : "btn primary";

  return (
    <>
      <form action={formAction} className={inline ? "row" : "stack"}>
        {children}
        <div className="row">
          {confirm && !armed ? (
            <button type="button" className={danger ? "btn danger-outline" : "btn"} onClick={() => setArmed(true)}>{submit}</button>
          ) : (
            <>
              <button type="submit" className={cls} disabled={pending}>{pending ? "Saving…" : confirm ?? submit}</button>
              {confirm && <button type="button" className="btn" onClick={() => setArmed(false)} disabled={pending}>Cancel</button>}
            </>
          )}
          <span role="status" aria-live="polite">
            {state.ok && !pending && <span className="ok">{state.ok}</span>}
            {state.error && !pending && <span className="error">{state.error}</span>}
          </span>
        </div>
      </form>
      {state.reauth && (
        <form action={reauthenticate}>
          <input type="hidden" name="next" value={next ?? "/admin"} />
          <button type="submit" className="btn primary">Sign in again</button>
        </form>
      )}
    </>
  );
}
