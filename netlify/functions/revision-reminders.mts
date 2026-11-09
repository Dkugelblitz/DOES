// Hourly Netlify Scheduled Function: emails revision reminders to people for whom it's
// 8-11 am locally, at most once per 20 hours each. Netlify's free plan stops functions after
// 10 seconds, so each run sends a small batch and stops early; later hours pick up the rest.
//
// Always queries Supabase (even with email off), which also keeps the free project from pausing.
// Email is sent only when SMTP_* and REMINDER_SECRET are set (see docs/SETUP.md).
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { buildReminder, type DueTopic } from "../../src/lib/reminders/email.ts";
import { unsubscribeUrl } from "../../src/lib/reminders/token.ts";

type Person = { user_id: string; email: string; display_name: string | null; due_count: number; topics: DueTopic[] };

const BUDGET_MS = 7000; // stop starting new emails after 7s to stay under the 10s limit

export default async () => {
  const started = Date.now();
  const env = process.env;
  const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) return Response.json({ ok: false, reason: "Supabase env vars missing" }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("reminder_batch", { p_limit: 8, p_from_hour: 8, p_to_hour: 11 });
  if (error) { console.error("reminder_batch failed:", error.message); return Response.json({ ok: false }, { status: 500 }); }
  const people = (data ?? []) as Person[];

  const smtpReady = env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.MAIL_FROM && env.REMINDER_SECRET;
  if (!smtpReady) {
    console.log(`Email not configured; ${people.length} reminder(s) would be sent this hour.`);
    return Response.json({ ok: true, sent: 0, waiting: people.length, email: "not configured" });
  }

  const port = Number(env.SMTP_PORT ?? 587);
  const mail = nodemailer.createTransport({
    host: env.SMTP_HOST, port, secure: port === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    connectionTimeout: 4000, greetingTimeout: 4000, socketTimeout: 5000,
  });
  const site = (env.NEXT_PUBLIC_SITE_URL ?? env.URL ?? "").replace(/\/+$/, "");
  let sent = 0, failed = 0;
  for (const p of people) {
    if (Date.now() - started > BUDGET_MS) break;
    const unsub = unsubscribeUrl(site, p.user_id, env.REMINDER_SECRET!);
    const m = buildReminder({ name: p.display_name, dueCount: p.due_count, topics: p.topics ?? [], siteUrl: site, unsubscribeUrl: unsub });
    try {
      await mail.sendMail({
        from: env.MAIL_FROM, to: p.email, subject: m.subject, text: m.text, html: m.html,
        headers: { "List-Unsubscribe": `<${unsub}>` },
      });
      await supabase.rpc("mark_reminder_sent", { p_user: p.user_id });
      sent++;
    } catch (e) {
      failed++;
      console.error("send failed:", (e as Error).message);
    }
  }
  mail.close();
  return Response.json({ ok: true, sent, failed, remaining: people.length - sent - failed });
};

export const config = { schedule: "@hourly" };
