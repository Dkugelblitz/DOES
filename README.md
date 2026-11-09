# DEOS: Data Engineering Operating System

Interview prep for Data Engineer, Principal Data Engineer and Data Architect levels.

## Status

- **Milestone 1 (seed extraction): done.**
- **Milestone 2 (schema, security and auth): done.** Google sign-in, one-level onboarding, `ADMIN_EMAILS` bootstrap, the full schema with row-level security, and level-gated content.

- **Milestone 3 (admin console): done.** User list and detail, grant and revoke levels with expiry, level requests, bulk grant, CSV import with invites, promote and demote with re-sign-in and a last-admin guard, disable accounts, and the audit log.
- **Milestone 4 (roadmap and progress): done.** Domains, modules and topics for the active level, subtopic checklists that drive status, readiness overall and per domain, and the ETA and on-pace plan.
- **Milestone 5 (Pareto and sprint): done.** A Pareto tab per held level with its own progress, and the 2-day sprint: time-blocked plan with checklists, flip cards with mastery, system designs with the answer framework, and the HackerRank AI guide, all filtered by level.
- **Milestone 6 (study tracking): done.** Server-timed study sessions with start, pause and finish, heartbeats that save closed tabs and skip idle time, a 240-minute rollover, and an Insights page: last 7 days, time of day, averages and topics covered.
- **Milestone 7 (notes and uploads): done.** Markdown notes with autosave and safe rendering, photo and PDF uploads through server-issued signed URLs (type, size and 25 MB quota checked twice, photos shrunk with thumbnails in the browser), saved links and excerpts, per-topic sharing with admins, an extractive summariser behind a swappable interface, a cross-topic summary page and "download my data".
- **Milestone 8 (revision and bookmarks): done.** Due (5+ days) and overdue (7+) revision list on Home, a Revised action that resets the clock, roadmap tags, bookmarks with a Bookmarks page, and an hourly Netlify job that emails morning reminders in each user's timezone (opt-out on Account and a signed one-click unsubscribe).
- **Milestone 9 (gamification): done.** XP awarded only by database triggers with idempotency keys (topic done 30 once per topic, due revision 10 once per cycle, note 5 and file 5 once per topic, 1 per study minute once per session), levels 1-7 with titles, daily streaks in the user's timezone, 13 data-driven badges, a backfill for earlier activity, and an Achievements page. Reminder emails are now opt-in.
- **Milestone 10 (encouragement, analytics, content editor, polish): done.** Personalised greeting (time of day, name, streak, revisions due, next suggested topic), a cheer with XP, level-ups and new badges on completion, a closing message when finishing for the day, admin analytics, an admin content editor for topics, subtopics, level flags, cards, designs and all guides/settings with version history and restore, private custom topics, a light/dark/auto theme switch and a skip link.

Setup from zero, on free tiers only: **[docs/SETUP.md](docs/SETUP.md)**.

## Layout

| Path | What it is |
|---|---|
| `supabase/migrations/` | Schema, access control (grants, RLS, helper functions), auth and bootstrap |
| `src/` | Next.js 16 app (App Router). `src/proxy.ts` refreshes sessions; the database enforces access |
| `scripts/` | Seed build, validate, review report, migrate and seed-to-database |
| `content/` | YAML content seed |
| `tests/` | Content tests, plus database security tests on a throwaway Postgres |

## Editing content

Admins edit everything learners see under **Admin → Content**: topics (name, module, minimum level, Pareto flags, subtopics, archive), flip cards, system designs, and the HackerRank guide, messages, gamification rules, settings, design framework and sprint intro. Every save is checked, versioned (any version can be restored, which adds a new version) and written to the audit log. Learners see changes immediately; no deploy is needed. The 2-day sprint plan's blocks are the one exception: they're still edited in `content/sprint.yaml` and loaded with `npm run db:seed -- --mode=force`.

## Who can join

**Admin → Access** switches between **Open** (anyone signing in with Google) and **Invite-only**. In invite-only mode, new people get in only if they were invited (Admin → Import), their email is on an allowed domain, or an admin approves their access request (Admin → Requests, tagged "new person"). Everyone else sees a waiting page. The check is in the database (`complete_onboarding`), so it can't be skipped, and changes are audited. Existing members are never affected.

## Rate limits

Admin actions, timer actions, notes, revisions, level requests and custom topics are rate-limited in the database. Sign-in is Google only and rate-limited by Supabase Auth itself (Authentication → Rate Limits).

## How access is enforced

- Every table has row-level security. Users only read and write their own rows.
- Levels come from `level_grants` on every query, never from the login token. Admins hold all three.
- Content (topics, subtopics, cards, designs, sprint) is filtered in the database by the caller's highest held level. Pareto flags are never readable directly, only through functions that check the level is held.
- Admins can read progress-type data, but a user's notes, links and attachments only for topics the user has shared.
- Writes that matter (grants, admin role, XP, stats, timestamps) go through server functions or triggers, never direct table writes.
- The audit log and content history are append-only, enforced by triggers.
- A test fails if any function becomes callable by end users without being on an explicit allowlist.

## Content seed

All content lives in `content/` as YAML. None of it is hard-coded in UI code.

| File | What it holds |
|---|---|
| `levels.yaml` | The 3 prep levels: key, name, icon, description |
| `domains.yaml` | 8 domains and their modules |
| `topics/*.yaml` | 148 topics, 499 subtopics, `min_level`, `pareto_levels` and provenance |
| `cards.yaml` | 37 flip cards. Each is linked to a topic and inherits that topic's level |
| `designs.yaml` | Answer framework and 6 system designs, each with a `min_level` |
| `sprint.yaml` | 2-day sprint: 13 blocks with item-level `min_level` |
| `hackerrank.yaml` | AI-assisted interview module, with a review-every-90-days marker |
| `gamification.yaml` | XP rules with idempotency keys, level formula and titles, streak, revision timing, 13 data-driven badges |
| `messages.yaml` | Greeting, cheer, closing and toast templates |
| `settings.yaml` | Progress defaults, resource kinds, upload limits sized for free tiers, summariser config |

```bash
npm install
npm run seed:build     # regenerate content/ from scripts/legacy/*
npm run seed:validate  # schema + cross-reference + level checks
npm run seed:report    # writes docs/content-review.md (flag review table)
npm test
```

The YAML is the **initial** seed. Once the database is seeded, admins edit content in the admin console, which keeps version history. `scripts/legacy/` holds verbatim copies of the data from the three prototype HTML files. `scripts/legacy/flags.mjs` holds the level flags that are under review.

## Zero-cost hosting plan

| Need | Free option | Limit we design around |
|---|---|---|
| Web app | Netlify Free | Fixed monthly credits; the site pauses if they run out. Production deploys only from `main`. |
| DB, auth, storage | Supabase Free | 500 MB database, 1 GB files, 5 GB egress. Pauses after 7 days of inactivity. No backups. |
| Auth email | Custom SMTP through a free transactional provider | Supabase's built-in sender is heavily rate-limited, so custom SMTP is needed. |
| Scheduled jobs | Netlify scheduled function, hourly | Each run fits Netlify's 10-second limit and also keeps Supabase from pausing. |
| Rate limiting | Postgres-backed limiter | No extra service. |
| Backups | GitHub Actions nightly `pg_dump` | Free on public repos, and within free minutes on private repos. |
| Thumbnails | Generated in the browser at upload | Avoids paid image transforms. |

Uploads are capped at 25 MB per user by default, and images are compressed to 1600 px before upload.
