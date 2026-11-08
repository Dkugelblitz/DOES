# DEOS setup (all free tiers)

You need four free accounts: **GitHub**, **Supabase**, **Google Cloud** (for Google sign-in only) and **Netlify**. No card is needed for any of these steps. Dashboard labels change from time to time, so if a name below doesn't match exactly, look for the closest equivalent.

Keep every key and password in `.env.local` on your machine and in Netlify's settings. Never commit them.

---

## 1. Supabase project (database, auth, storage)

1. Sign in at supabase.com and create a **new project** on the Free plan. Pick the region closest to your users (for India, Mumbai `ap-south-1`).
2. Save the **database password** somewhere safe. You need it once for `DATABASE_URL`.
3. Open **Project Settings → API Keys** and copy:
   - the project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - the **publishable** key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - the **secret** key → `SUPABASE_SECRET_KEY` (server only)
4. Click **Connect** at the top of the dashboard, choose the **Session pooler** connection string, put your password in it, and use that as `DATABASE_URL`.

## 2. Local setup and database

```bash
cp .env.example .env.local      # fill in the values from step 1
npm install
npm run db:setup                # applies migrations, then seeds content (safe to rerun)
npm run dev                     # http://localhost:3000
```

`db:setup` only adds content that isn't there yet, so it never overwrites edits made later in the admin console. To force YAML back over the database (it keeps version history), run `npm run db:seed -- --mode=force`.

## 3. Auth settings in Supabase

**Authentication → URL Configuration**
- Site URL: `http://localhost:3000` for now (change to your Netlify address in step 6).
- Redirect URLs: add `http://localhost:3000/auth/callback` and later the Netlify ones from step 6.

**Authentication → Providers → Email**
- Keep **Confirm email** turned on. The admin bootstrap only promotes verified emails.
- Set minimum password length to 8.

**Email template:** no change needed. The app accepts the default confirmation link. (If you customise the template later, you can link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`.)

**Custom SMTP (needed for real users)**
Supabase's built-in email sender is limited to a handful of emails per hour and only for testing. Turn on **Custom SMTP** (Authentication → Emails → SMTP Settings) with a free sender. Options that cost nothing:
- **Gmail with an App Password** (no domain needed). Turn on 2-step verification on the Google account, create an App Password, then use host `smtp.gmail.com`, port `587`, your Gmail address as user and the App Password as password. Good for a small user base.
- **A free transactional provider** (Brevo, Resend, etc.). Better deliverability, but most need a domain you own. Check their current free limits.

After saving, raise **Authentication → Rate Limits → emails per hour** to a value your provider allows.

## 4. Google sign-in

1. Go to console.cloud.google.com, create a project (free), and open **APIs & Services → OAuth consent screen**. Choose **External**, fill in the app name and your email, and add the scopes `email`, `profile` and `openid`.
2. Open **Credentials → Create credentials → OAuth client ID → Web application**.
3. Under **Authorised redirect URIs**, add the callback URL that Supabase shows in **Authentication → Providers → Google** (it looks like `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`).
4. Copy the **Client ID** and **Client secret** into Supabase's Google provider settings and enable it.
5. While the consent screen is in "Testing" mode, only test users you list can sign in. Publish it when you're ready for the public.

## 5. Make yourself the first admin

1. Put your email in `ADMIN_EMAILS` (comma-separate several).
2. Sign up in the app and verify your email (or use Google, which arrives verified).
3. You're promoted automatically the next time you sign in. Every promotion is recorded in the audit log.

This only ever runs on the server with the secret key. There is no client-side flag or sign-up field that can trigger it.

## 6. Deploy on Netlify (free plan)

1. Push the project to a GitHub repository (private is fine).
2. On netlify.com, sign up with GitHub, then **Add new project → Import an existing project → GitHub** and pick the repository. Netlify reads `netlify.toml`, so leave the build settings as they are.
3. Before the first deploy, open **Project configuration → Environment variables** and add everything from `.env.example` **except `DATABASE_URL`** (only the scripts on your computer need it):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ADMIN_EMAILS`, and `NEXT_PUBLIC_SITE_URL` set to your Netlify address (for example `https://deos-prep.netlify.app`).
4. Deploy. If you change environment variables later, trigger a new deploy for them to take effect.
5. Add the live address everywhere sign-in needs it:
   - **Supabase → Authentication → URL Configuration:** set **Site URL** to the Netlify address, and add `https://YOUR-SITE.netlify.app/auth/callback` and `https://YOUR-SITE.netlify.app/auth/confirm` to **Redirect URLs**. Keep the localhost ones for development.
   - **Google Cloud → your OAuth client:** add `https://YOUR-SITE.netlify.app` to **Authorised JavaScript origins**. The redirect URI (the Supabase callback) stays the same.

**Keeping within the free credits.** Netlify's free plan gives a fixed number of credits a month, and the site pauses if they run out. Each production deploy uses a chunk of them, so:
- production builds only from `main`; do day-to-day work on other branches (branch deploys and Deploy Previews are free);
- merge to `main` when you want to release, not after every small change;
- check **Usage** in the Netlify dashboard now and then.

## Free-tier limits to keep in mind

| Service | Limit | What DEOS does about it |
|---|---|---|
| Netlify Free | Fixed monthly credits shared by deploys, bandwidth, requests and compute; site pauses when they run out | Production deploys only from `main`; free branch previews for everything else |
| Supabase Free | 500 MB DB, 1 GB files, 5 GB egress/month | 25 MB upload quota per user; images compressed before upload |
| Supabase Free | Project pauses after 7 days with no activity | The daily reminder job keeps it awake (Milestone 8) |
| Supabase Free | No automatic backups | Nightly `pg_dump` via GitHub Actions (added later) |

## Running the tests

```bash
npm test               # everything
npm run test:content   # seed content only (no database needed)
npm run test:db        # database security tests
```

The database tests start a throwaway local Postgres 16 and need its binaries installed (`apt install postgresql-16`, or set `PG_BIN` to their folder). They use a small shim that mimics Supabase's roles and `auth` schema, so they never touch your real project.
