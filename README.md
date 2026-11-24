# JobScout

A nightly job-search pipeline for Israel. Each night it:

1. **Collects** open jobs from ~145 Israeli tech companies' public job boards (Greenhouse, Lever, Ashby, Comeet, SmartRecruiters). It can also read LinkedIn job-alert emails from Gmail.
2. **Filters**: keeps Tel Aviv area, other Israel, or remote-from-Israel jobs. Drops senior, lead and manager roles, and ads asking for 5+ years.
3. **Scores** each job 0–10. Keyword rules always run. If a Gemini key (free) or an Anthropic key is set, AI also scores each job, writes a one-line reason, picks which CV version to send and drafts a one-line opener (the **apply kit**).
4. **Dedupes** by a hash of the job URL and **stores** new jobs in Supabase.
5. **Sends** a morning digest by email (or Telegram) with the top 10 new jobs and any follow-ups due. On Thursdays it also sends a weekly summary.
6. **Listens** for replies: you, or an assistant that reads your email, reply with lines like `applied 3f9c2` and JobScout updates the job and confirms by email (every 2 hours, and before each nightly run).

You (or your assistant) send the applications. JobScout finds, ranks and tracks them.

> **LinkedIn:** JobScout never visits, scrapes or automates linkedin.com (LinkedIn User Agreement section 8.2). The optional LinkedIn source only reads the alert emails LinkedIn already sends you, in read-only mode.

Target roles, highest first: Technical Support Engineer, Implementation / Integration / Onboarding Engineer, Customer Success Engineer, AI automation / internal tools, then junior full-stack. To change them, edit `src/scoring/rules.ts` (keywords) and `config/profile.md` (what the AI scorer is told about you, including your CV versions and the facts an opener may use).

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
| `npm run pipeline -- --no-claude` | Skip AI scoring, Gemini or Claude (keyword scores only) |
| `npm run pipeline -- --only=comeet,Riskified --max-companies=5` | Quick test on a few boards |
| `npm run weekly` | Send the weekly summary now |
| `npm run telegram:chat-id` | Find your Telegram chat id (add `-- --test` to send a test message) |
| `npm test` | Unit tests (rules, URL dedupe, parsers) |

Every setting is optional. Without Supabase, jobs go to `data/jobs.json`. Without email (or Telegram), the digest prints in the terminal. Without a Gemini or Anthropic key, only keyword scores are used.

---

## Setup

### 1. Supabase (where jobs are stored)

Create a free Supabase project (or reuse one you have), then run `supabase/schema.sql` in its SQL editor to create the `jobscout_jobs` table.

- `SUPABASE_URL`: Project Settings → Data API → the project URL (`https://<your-project>.supabase.co`)
- `SUPABASE_SECRET_KEY`: Project Settings → API Keys → the **secret** key (`sb_secret_…`) or the legacy `service_role` key. Row-level security is on, so the public key can't read the table.

**Working with the table:** reply commands (below) do this for you. By hand: open Table Editor → `jobscout_jobs` and change `status`: `new` → `starred` / `applied` / `replied` / `interview` / `rejected` / `skipped`.

- Setting `applied` fills `applied_date` (today) and `follow_up_date` (+7 days) automatically.
- The digest lists follow-ups that are due.
- `notes` is free text for you.

Columns: date found, company, title, link, location, source, score, reason, status, applied date, follow-up date, notes, CV version, opener.

### 2. Morning digest: email (default) or Telegram

`DIGEST_CHANNEL` picks where the digest goes: `email` (the default) or `telegram`. Both senders stay in the code, so switching back is one setting. The content is the same either way: each job's title, company, score, the reason it fits, and a link to the ad.

**Email (SMTP, Gmail by default):**

1. In the Google account that will send the email, turn on 2-step verification, then create an **App password** (myaccount.google.com/apppasswords).
2. Set `SMTP_USER` to that Gmail address and `SMTP_PASSWORD` to the app password (never your normal password).
3. Set `DIGEST_EMAIL_TO` to the address that should get the digest (several can be separated by commas).
4. Another provider? Set `SMTP_HOST` and `SMTP_PORT` too (defaults: `smtp.gmail.com`, `465`).

**Telegram:** set `DIGEST_CHANNEL=telegram`, then:

1. In Telegram, message **@BotFather**, send `/newbot`, and copy the token into `TELEGRAM_BOT_TOKEN`.
2. Send your new bot any message, for example "hi".
3. Run `npm run telegram:chat-id` and copy the printed `TELEGRAM_CHAT_ID=...` line into `.env`.
4. Run `npm run telegram:chat-id -- --test` to check that a message arrives.

**Managing applications by email.** Each job in an email shows a 5-character id in [brackets]. Reply to any JobScout email (or send one with "JobScout" in the subject) to the `SMTP_USER` address, one command per line:

| Command | What it does |
|---|---|
| `applied 3f9c2` (or `applied 3f9c2 2026-11-20`) | Marks it applied and sets a follow-up 7 days later |
| `interview 3f9c2 2026-12-03 phone screen` | Interview on that date; the date becomes the reminder |
| `replied 3f9c2` / `rejected 3f9c2` | They answered / they said no |
| `skip 3f9c2` (or `not for me 3f9c2`) | Not a fit; it stops appearing |
| `star 3f9c2` / `unstar 3f9c2` | Shortlist |
| `note 3f9c2 recruiter is Dana` | Adds a dated note |
| `follow up 3f9c2 2026-12-10` | Sets the reminder date |
| `list` / `help` | Everything in progress / this list |

Text that isn't a command, and the quoted email below your reply, are ignored. A confirmation email lists every change.

- Commands are read from the `SMTP_USER` inbox over IMAP (same app password). JobScout only looks at mail from the last 14 days with "JobScout" in the subject, and labels what it handled `JobScout-done` so nothing is applied twice.
- Only senders in `COMMAND_SENDERS` count (default: `DIGEST_EMAIL_TO` and `SMTP_USER`), and only when Gmail recorded a DKIM or SPF pass for the sender's domain, so a forged From: line is ignored.
- If a run fails, an email says so.

### 3. AI scoring (optional)

Only the top `CLAUDE_MAX_JOBS` new jobs per night (default 40) are sent to AI scoring. That's usually a few on a normal night, but the first run sees every currently open job. If a call fails, the job keeps its keyword score.

**Gemini (free, used when set):** create a key at aistudio.google.com → **Get API key**, and set `GEMINI_API_KEY`. JobScout picks the newest Gemini flash model your key can use (pin one with `GEMINI_MODEL`). The free tier allows only a few requests a minute, so jobs are scored one at a time, about 7 seconds apart; if the daily free quota runs out, the rest keep their keyword scores. On the free tier Google may use what you send to improve its products: the job ads and `config/profile.md`, which is public in this repo anyway.

**Claude (paid):** set `ANTHROPIC_API_KEY` from console.anthropic.com instead. The API is billed separately from a Claude.ai subscription. The default model is `claude-opus-5-5`; set `CLAUDE_MODEL=claude-haiku-5-5` for a much cheaper option. If both keys are set, Gemini is used.

### 4. LinkedIn alert emails (optional)

1. On LinkedIn, create job alerts (by hand, in the LinkedIn app or site) for your target titles in Israel, delivered by email.
2. In your Google account, turn on 2-step verification, then create an **App password**.
3. Set `GMAIL_USER` and `GMAIL_APP_PASSWORD`. JobScout reads alerts from the last 2 days and keeps the title, company, location and link.

### 5. Nightly schedule: GitHub Actions

`.github/workflows/nightly.yml` runs every day at 22:17 UTC (00:17 Israel winter time, 01:17 summer time). GitHub often starts scheduled runs hours late, so the run is set just after midnight and the digest is still waiting when you wake up.

1. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**. Add the secrets you use:
   - `SUPABASE_URL`, `SUPABASE_SECRET_KEY`
   - `SMTP_USER`, `SMTP_PASSWORD`, `DIGEST_EMAIL_TO` (email digest)
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (only for the Telegram digest)
   - `GEMINI_API_KEY` (free) or `ANTHROPIC_API_KEY` (paid)
   - `GMAIL_USER`, `GMAIL_APP_PASSWORD`
   - `COMMAND_SENDERS` (optional: who may send reply commands)
2. Optional **Variables** (same page, Variables tab): `DIGEST_CHANNEL` (`email` or `telegram`), `SMTP_HOST`, `SMTP_PORT`, `IMAP_HOST`, `GEMINI_MODEL`, `CLAUDE_MODEL`, `CLAUDE_MAX_JOBS`, `KIT_BACKFILL_PER_RUN`, `DIGEST_MIN_SCORE`.
3. Scheduled workflows only run from the default branch (`master`), so the workflow starts after this branch is merged.
4. To test it, open the **Actions** tab → **Nightly job scan** → **Run workflow** (tick "Dry run" first if you like).

`.github/workflows/inbox.yml` applies reply commands every 2 hours.

GitHub emails you if a scheduled run fails, and JobScout emails the digest address too. A run takes about 1–2 minutes, and Actions minutes are free for public repos.

### Alternative: Windows Task Scheduler (runs on your PC instead)

Run once in a terminal. The PC has to be on at 07:00. Output goes to `data\nightly.log`.

```bash
schtasks /Create /TN "JobScout nightly" /SC DAILY /ST 07:00 /TR "\"F:\Programming\new stuff\JobScout\scripts\nightly.cmd\""
```

Use one schedule or the other, not both. Both would work, but the second run would just find nothing new.

---

## Target companies

`config/companies.json` lists ~145 Israeli companies with support, implementation, customer-success or operations teams, and which job board each uses. Boards were checked live on 2026-11-18, and 62 more on 2026-11-24.

- **Greenhouse / Lever / Ashby:** `board` is the board name from the company's job-board URL, for example `boards.greenhouse.io/riskified` → `riskified`.
- **Lever EU:** boards at `jobs.eu.lever.co` (for example Mobileye) need `"region": "eu"`.
- **SmartRecruiters:** `board` is the company id from `jobs.smartrecruiters.com/<id>`. Add `"country": "il"` to fetch only Israeli postings. The list has no descriptions, so each posting costs one more request.
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
- **AI** (`src/scoring/gemini.ts`, or `src/scoring/claude.ts`): reads the full ad and `config/profile.md`, then returns a score, a one-line reason, the CV version to send (support / implementation / automation / full-stack) and a one-line opener built only from facts in the profile. When available, this replaces the keyword score. Open jobs stored before the apply kit existed get one a few at a time (`KIT_BACKFILL_PER_RUN`, default 15) while their ads are still up.
- Only jobs scoring `DIGEST_MIN_SCORE` (default 5) or higher go into the digest. Everything that passed the rules is still stored.

## Project layout

```
config/companies.json     target companies + which job board each uses
config/profile.md         your profile, used by AI scoring
src/collectors/           greenhouse, lever, ashby, comeet, smartrecruiters, linkedinEmail
src/scoring/              rules.ts (keywords), gemini.ts and claude.ts (AI score)
src/storage/              supabase.ts, localFile.ts (data/jobs.json fallback)
src/digest/format.ts      morning digest + weekly summary text
src/notify/email.ts       email sender (SMTP)
src/notify/telegram.ts    Telegram sender
src/inbox/                reply commands: commands.ts (parse + apply), mailbox.ts (IMAP, sender checks)
src/pipeline.ts           the nightly run, step by step
src/index.ts              command-line entry point
supabase/schema.sql       table + auto follow-up-date trigger
.github/workflows/        nightly run + inbox commands every 2 hours
```
