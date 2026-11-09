"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseImportCsv, type ImportProblem } from "@/lib/csv-import";

// Every action here relays to a database function that re-checks is_admin, rate-limits and
// writes the audit entry. These wrappers only validate input shape and map errors to text.

export type ActionResult = { ok?: string; error?: string; reauth?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const level = (v: FormDataEntryValue | null) => { const n = Number(v); return [1, 2, 3].includes(n) ? n : null; };
const uuid = (v: FormDataEntryValue | null) => { const s = String(v ?? ""); return UUID.test(s) ? s : null; };

/** Optional expiry from a date input: end of that day in UTC, as ISO. */
function expiry(v: FormDataEntryValue | null): string | null | undefined {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  return `${s}T23:59:59Z`;
}

function fail(message: string): ActionResult {
  if (message.includes("admin only")) return { error: "You no longer have admin access." };
  if (message.includes("reauth required")) return { error: "For your security, sign in again to confirm this change.", reauth: true };
  // Messages raised by our own database functions are written for people; anything else is generic.
  const known = /(level|admin|account|request|invite|expiry|user|rows|email|wait|already)/i;
  return { error: known.test(message) && message.length < 160 ? message.charAt(0).toUpperCase() + message.slice(1) + "." : "Something went wrong. Please try again." };
}

async function run(fn: string, args: Record<string, unknown>, ok: string, paths: string[]): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return fail(error.message);
  paths.forEach((p) => revalidatePath(p));
  return { ok };
}

export async function grantLevel(_: ActionResult, form: FormData): Promise<ActionResult> {
  const u = uuid(form.get("user_id")), l = level(form.get("level")), e = expiry(form.get("expires_on"));
  if (!u || !l || e === undefined) return { error: "Choose a level (and a valid date, if any)." };
  return run("admin_grant_level", { p_user: u, p_level: l, p_expires_at: e, p_note: null }, "Level saved.", [`/admin/users/${u}`, "/admin/users"]);
}

export async function revokeLevel(_: ActionResult, form: FormData): Promise<ActionResult> {
  const u = uuid(form.get("user_id")), l = level(form.get("level"));
  if (!u || !l) return { error: "Invalid request." };
  return run("admin_revoke_level", { p_user: u, p_level: l }, "Level revoked. Their progress is kept.", [`/admin/users/${u}`, "/admin/users"]);
}

export async function setActiveLevelFor(_: ActionResult, form: FormData): Promise<ActionResult> {
  const u = uuid(form.get("user_id")), l = level(form.get("level"));
  if (!u || !l) return { error: "Invalid request." };
  return run("admin_set_active_level", { p_user: u, p_level: l }, "Default level updated.", [`/admin/users/${u}`]);
}

export async function setAdmin(_: ActionResult, form: FormData): Promise<ActionResult> {
  const u = uuid(form.get("user_id")), on = form.get("is_admin") === "true";
  if (!u) return { error: "Invalid request." };
  return run("admin_set_admin", { p_user: u, p_is_admin: on }, on ? "Promoted to admin." : "Admin access removed.", [`/admin/users/${u}`, "/admin/users"]);
}

export async function setDisabled(_: ActionResult, form: FormData): Promise<ActionResult> {
  const u = uuid(form.get("user_id")), off = form.get("disabled") === "true";
  if (!u) return { error: "Invalid request." };
  return run("admin_set_disabled", { p_user: u, p_disabled: off }, off ? "Account disabled." : "Account enabled.", [`/admin/users/${u}`, "/admin/users"]);
}

export async function bulkGrant(_: ActionResult, form: FormData): Promise<ActionResult> {
  const ids = form.getAll("ids").map((v) => uuid(v)).filter((v): v is string => !!v);
  const l = level(form.get("level")), e = expiry(form.get("expires_on"));
  if (!ids.length) return { error: "Tick at least one user first." };
  if (!l || e === undefined) return { error: "Choose a level (and a valid date, if any)." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_bulk_grant", { p_users: ids, p_level: l, p_expires_at: e });
  if (error) return fail(error.message);
  revalidatePath("/admin/users");
  const r = data as { granted: number; already_held: number };
  return { ok: `Granted to ${r.granted} user${r.granted === 1 ? "" : "s"}${r.already_held ? `; ${r.already_held} already had it` : ""}.` };
}

export async function decideRequest(_: ActionResult, form: FormData): Promise<ActionResult> {
  const id = Number(form.get("request_id")), approve = form.get("decision") === "approve";
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
  if (!Number.isInteger(id) || id <= 0) return { error: "Invalid request." };
  return run("admin_decide_request", { p_request: id, p_approve: approve, p_note: note }, approve ? "Approved." : "Denied.", ["/admin/requests", "/admin"]);
}

export type ImportState = ActionResult & { granted?: number; invited?: number; problems?: ImportProblem[]; skipped?: { email: string; reason: string }[] };

export async function importUsers(_: ImportState, form: FormData): Promise<ImportState> {
  const text = String(form.get("csv") ?? "");
  if (text.length > 200_000) return { error: "That file is too big. Import at most 500 rows at a time." };
  const { rows, problems } = parseImportCsv(text);
  if (!rows.length) return { error: "No valid rows found. Each line needs an email and levels, e.g. priya@example.com,1;2", problems };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_import_users", { p_rows: rows.map(({ email, levels }) => ({ email, levels })) });
  if (error) return { ...fail(error.message), problems };
  revalidatePath("/admin/import"); revalidatePath("/admin/users");
  const r = data as { granted: number; invited: number; skipped: { email: string; reason: string }[] };
  return { ok: "Import finished.", granted: r.granted, invited: r.invited, skipped: r.skipped, problems };
}

export async function deleteInvite(_: ActionResult, form: FormData): Promise<ActionResult> {
  const email = String(form.get("email") ?? "").trim();
  if (!email.includes("@")) return { error: "Invalid request." };
  return run("admin_delete_invite", { p_email: email }, "Invite removed.", ["/admin/import"]);
}
