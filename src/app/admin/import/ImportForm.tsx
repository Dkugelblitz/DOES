"use client";
import { useActionState, useRef } from "react";
import { importUsers, type ImportState } from "../actions";

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importUsers, {});
  const area = useRef<HTMLTextAreaElement>(null);

  const loadFile = async (f: File | undefined) => {
    if (!f || !area.current) return;
    if (f.size > 200_000) { area.current.value = ""; alertMsg("That file is too big. Split it into files of at most 500 rows."); return; }
    area.current.value = await f.text();
  };
  const alertMsg = (m: string) => { const el = document.getElementById("import-msg"); if (el) el.textContent = m; };

  return (
    <form action={action} className="stack">
      <label>CSV file (optional)
        <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => loadFile(e.target.files?.[0])} />
      </label>
      <label>Or paste rows
        <textarea ref={area} name="csv" rows={8} spellCheck={false} placeholder={"email,levels\npriya@example.com,1\nravi@example.com,2;3"} style={{ fontFamily: "ui-monospace, monospace" }} />
      </label>
      <div className="row">
        <button className="btn primary" type="submit" disabled={pending}>{pending ? "Importing…" : "Import"}</button>
        <span id="import-msg" role="status" aria-live="polite">
          {state.error && !pending && <span className="error">{state.error}</span>}
          {state.ok && !pending && <span className="ok">{state.ok} {state.granted} level grant(s) to existing users, {state.invited} invite(s) created.</span>}
        </span>
      </div>
      {!!(state.problems?.length || state.skipped?.length) && (
        <div className="card">
          <strong>Rows not imported</strong>
          <ul className="mini">
            {state.problems?.map((p) => <li key={`p${p.line}`}><span>Line {p.line}: <code>{p.text}</code></span><span className="error">{p.reason}</span></li>)}
            {state.skipped?.map((s, i) => <li key={`s${i}`}><span>{s.email}</span><span className="error">{s.reason}</span></li>)}
          </ul>
        </div>
      )}
    </form>
  );
}
