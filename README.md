# DEOS: Data Engineering Operating System

Interview prep for Data Engineer, Principal Data Engineer and Data Architect levels.

## Status

- **Milestone 1 (seed extraction): done.**
- **Milestone 2 (schema, security and auth): done.** Google and email sign-in, one-level onboarding, `ADMIN_EMAILS` bootstrap, the full schema with row-level security, and level-gated content.

- **Milestone 3 (admin console): done.** User list and detail, grant and revoke levels with expiry, level requests, bulk grant, CSV import with invites, promote and demote with re-sign-in and a last-admin guard, disable accounts, and the audit log.
- **Milestone 4 (roadmap and progress): done.** Domains, modules and topics for the active level, subtopic checklists that drive status, readiness overall and per domain, and the ETA and on-pace plan.
- **Milestone 5 (Pareto and sprint): done.** A Pareto tab per held level with its own progress, and the 2-day sprint: time-blocked plan with checklists, flip cards with mastery, system designs with the answer framework, and the HackerRank AI guide, all filtered by level.
- **Milestone 6 (study tracking): done.** Server-timed study sessions with start, pause and finish, heartbeats that save closed tabs and skip idle time, a 240-minute rollover, and an Insights page: last 7 days, time of day, averages and topics covered.
- **Milestone 7 (notes and uploads): done.** Markdown notes with autosave and safe rendering, photo and PDF uploads through server-issued signed URLs (type, size and 25 MB quota checked twice, photos shrunk with thumbnails in the browser), saved links and excerpts, per-topic sharing with admins, an extractive summariser behind a swappable interface, a cross-topic summary page and "download my data".
- **Milestone 8 (revision and bookmarks): done.** Due (5+ days) and overdue (7+) revision list on Home, a Revised action that resets the clock, roadmap tags, bookmarks with a Bookmarks page, and an hourly Netlify job that emails morning reminders in each user's timezone (opt-out on Account and a signed one-click unsubscribe).

Setup from zero, on free tiers only: **[docs/SETUP.md](docs/SETUP.md)**.

## Layout

| Path | What it is |
|---|---|
| `supabase/migrations/` | Schema, access control (grants, RLS, helper functions), auth and bootstrap |
| `src/` | Next.js 16 app (App Router). `src/proxy.ts` refreshes sessions; the database enforces access |
| `scripts/` | Seed build, validate, review report, migrate and seed-to-database |
| `content/` | YAML content seed |
| `tests/` | Content tests, plus database security tests on a throwaway Postgres |

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
