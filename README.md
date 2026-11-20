# JobScout

A nightly job-search pipeline for Israel. Each night it:

1. **Collects** open jobs from ~75 Israeli tech companies' public job boards (Greenhouse, Lever, Ashby, Comeet). It can also read LinkedIn job-alert emails from Gmail.
2. **Filters**: keeps Tel Aviv area, other Israel, or remote-from-Israel jobs. Drops senior, lead and manager roles, and ads asking for 5+ years.
3. **Scores** each job 0–10. Keyword rules always run. If an Anthropic key is set, Claude also scores each job and writes a one-line reason.
4. **Dedupes** by a hash of the job URL and **stores** new jobs in Supabase.
5. **Sends** a morning Telegram digest of the top 10 new jobs and any follow-ups due. On Thursdays it also sends a weekly summary.

You handle applications and referrals yourself. JobScout only finds and ranks jobs.

> **LinkedIn:** JobScout never visits, scrapes or automates linkedin.com (LinkedIn User Agreement section 8.2). The optional LinkedIn source only reads the alert emails LinkedIn already sends you, in read-only mode.

Target roles, highest first: Technical Support Engineer, Implementation / Integration / Onboarding Engineer, Customer Success Engineer, AI automation / internal tools, then junior full-stack. To change them, edit `src/scoring/rules.ts` (keywords) and `config/profile.md` (what Claude is told about you).

---

## Quick start (local)

Requires Node 22 or newer (tested on Node 24).

```bash
npm install
```

```bash
cp .env.example .env
```

Fill in `.env` (see [Setup](#setup)). Then:

```bash
npm run pipeline:dry
```

That collects and scores everything, then prints the digest in the terminal. Nothing is saved or sent. When it looks right:

```bash
npm run pipeline
```

| Command | What it does |
|---|---|
| `npm run pipeline` | Full run: collect, score, save, send digest (and the weekly summary on Thursdays) |
| `npm run pipeline:dry` | Same, but saves nothing and sends nothing |
| `npm run pipeline -- --no-claude` | Skip Claude scoring (keyword scores only) |
| `npm run pipeline -- --only=comeet,Riskified --max-companies=5` | Quick test on a few boards |
| `npm run weekly` | Send the weekly summary now |
| `npm run telegram:chat-id` | Find your Telegram chat id (add `-- --test` to send a test message) |
| `npm test` | Unit tests (rules, URL dedupe, parsers) |

Every setting is optional. Without Supabase, jobs go to `data/jobs.json`. Without Telegram, the digest prints in the terminal. Without an Anthropic key, only keyword scores are used.

---

## Setup

### 1. Supabase (where jobs are stored)

Create a free Supabase project (or reuse one you have), then run `supabase/schema.sql` in its SQL editor to create the `jobscout_jobs` table.

- `SUPABASE_URL`: Project Settings → Data API → the project URL (`https://<your-project>.supabase.co`)
- `SUPABASE_SECRET_KEY`: Project Settings → API Keys → the **secret** key (`sb_secret_…`) or the legacy `service_role` key. Row-level security is on, so the public key can't read the table.

**Working with the table:** open Table Editor → `jobscout_jobs` and change `status` as you go: `new` → `starred` / `applied` / `replied` / `interview` / `rejected`.

- Setting `applied` fills `applied_date` (today) and `follow_up_date` (+7 days) automatically.
- The digest lists follow-ups that are due.
- `notes` is free text for you.

Columns: date found, company, title, link, location, source, score, reason, status, applied date, follow-up date, notes.

### 2. Telegram (morning digest)

1. In Telegram, message **@BotFather**, send `/newbot`, and copy the token into `TELEGRAM_BOT_TOKEN`.
2. Send your new bot any message, for example "hi".
3. Run `npm run telegram:chat-id` and copy the printed `TELEGRAM_CHAT_ID=...` line into `.env`.
4. Run `npm run telegram:chat-id -- --test` to check that a message arrives.

### 3. Claude scoring (optional)

Set `ANTHROPIC_API_KEY` from console.anthropic.com. Only the top `CLAUDE_MAX_JOBS` new jobs per night (default 40) are sent to Claude. That's usually a few on a normal night, but the first run sees every currently open job.

The default model is `claude-opus-5-5`. Set `CLAUDE_MODEL=claude-haiku-5-5` for a much cheaper option. If a Claude call fails, the job keeps its keyword score.

### 4. LinkedIn alert emails (optional)

1. On LinkedIn, create job alerts (by hand, in the LinkedIn app or site) for your target titles in Israel, delivered by email.
2. In your Google account, turn on 2-step verification, then create an **App password**.
3. Set `GMAIL_USER` and `GMAIL_APP_PASSWORD`. JobScout reads alerts from the last 2 days and keeps the title, company, location and link.

### 5. Nightly schedule: GitHub Actions

`.github/workflows/nightly.yml` runs every day at 03:30 UTC (05:30 Israel winter time, 06:30 summer time), so the digest is waiting when you wake up.

1. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**. Add the secrets you use:
   - `SUPABASE_URL`, `SUPABASE_SECRET_KEY`
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
   - `ANTHROPIC_API_KEY`
   - `GMAIL_USER`, `GMAIL_APP_PASSWORD`
2. Optional **Variables** (same page, Variables tab): `CLAUDE_MODEL`, `CLAUDE_MAX_JOBS`, `DIGEST_MIN_SCORE`.
3. Scheduled workflows only run from the default branch (`master`), so the workflow starts after this branch is merged.
4. To test it, open the **Actions** tab → **Nightly job scan** → **Run workflow** (tick "Dry run" first if you like).

GitHub emails you if a scheduled run fails. A run takes about 1–2 minutes, well inside the free Actions minutes for a private repo.

### Alternative: Windows Task Scheduler (runs on your PC instead)

Run once in a terminal. The PC has to be on at 07:00. Output goes to `data\nightly.log`.

```bash
schtasks /Create /TN "JobScout nightly" /SC DAILY /ST 07:00 /TR "\"F:\Programming\new stuff\JobScout\scripts\nightly.cmd\""
```

Use one schedule or the other, not both. Both would work, but the second run would just find nothing new.

---

## Target companies

`config/companies.json` lists ~75 Israeli companies with support, implementation, customer-success or operations teams, and which job board each uses. All boards were checked live on 2026-11-18.

- **Greenhouse / Lever / Ashby:** `board` is the board name from the company's job-board URL, for example `boards.greenhouse.io/riskified` → `riskified`.
- **Comeet:** `board` is `slug/UID` from the company's `comeet.com/jobs/<slug>/<UID>` careers page. Comeet's official Careers API needs a token the company gives its own web developer, so JobScout reads the public hosted careers page instead. The listings are embedded in the page as JSON. That's one request per company per night.
- Set `"enabled": false` to skip a company. Add new ones the same way. A board that fails is logged and skipped, never fatal.

Requests are polite: at most one request per second per host, and a descriptive User-Agent (set `CONTACT` to add your email).

## How scoring works

- **Keyword rules** (`src/scoring/rules.ts`):
  - Location must be in Israel or remote-friendly.
  - Titles with senior / sr / lead / head / director / manager / principal / staff / architect are dropped (except customer-success or technical account manager).
  - Ads asking for 5+ years are dropped.
  - The title must match a target role, and earlier roles in the list score higher.
  - Small adjustments: Tel Aviv area, junior-friendly wording, your stack in the description, ads asking for 3+ years, and student-only roles.
- **Claude** (`src/scoring/claude.ts`): reads the full ad and `config/profile.md`, then returns a score and a one-line reason. When available, this replaces the keyword score.
- Only jobs scoring `DIGEST_MIN_SCORE` (default 5) or higher go into the digest. Everything that passed the rules is still stored.

## Project layout

```
config/companies.json     target companies + which job board each uses
config/profile.md         your profile, used by Claude scoring
src/collectors/           greenhouse, lever, ashby, comeet, linkedinEmail
src/scoring/              rules.ts (keywords), claude.ts (AI score)
src/storage/              supabase.ts, localFile.ts (data/jobs.json fallback)
src/digest/format.ts      morning digest + weekly summary text
src/notify/telegram.ts    Telegram sender
src/pipeline.ts           the nightly run, step by step
src/index.ts              command-line entry point
supabase/schema.sql       table + auto follow-up-date trigger
.github/workflows/        nightly GitHub Actions schedule
```
