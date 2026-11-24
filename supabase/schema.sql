-- JobScout table. Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists public.jobscout_jobs (
  url_hash        text primary key,                 -- sha256 of the normalized job URL (dedupe key)
  date_found      date not null default (now() at time zone 'Asia/Jerusalem')::date,
  company         text not null,
  title           text not null,
  link            text not null,
  location        text,
  source          text not null,                    -- greenhouse / lever / ashby / comeet / smartrecruiters / linkedin-email
  score           numeric(4,1) not null default 0,  -- 0-10
  reason          text,                             -- one-line reason (Claude, or rule summary)
  status          text not null default 'new'
                  check (status in ('new','starred','applied','replied','interview','rejected','skipped')),
  applied_date    date,
  follow_up_date  date,
  notes           text,
  digested_at     timestamptz,                      -- when it was sent in a morning digest
  cv_variant      text,                             -- apply kit: support / implementation / automation / fullstack
  pitch           text,                             -- apply kit: one-line opener
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists jobscout_jobs_date_found_idx on public.jobscout_jobs (date_found desc);
create index if not exists jobscout_jobs_status_idx on public.jobscout_jobs (status);

-- Row-level security on, no policies: only the secret (service-role) key used
-- by the pipeline can read or write. The public anon key sees nothing.
alter table public.jobscout_jobs enable row level security;

-- When you set status = 'applied' by hand: fill applied_date (today) and
-- follow_up_date (+7 days) if empty. Always bump updated_at.
create or replace function public.jobscout_jobs_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status = 'applied' and new.applied_date is null then
    new.applied_date := (now() at time zone 'Asia/Jerusalem')::date;
  end if;
  if new.applied_date is not null and new.follow_up_date is null then
    new.follow_up_date := new.applied_date + 7;
  end if;
  return new;
end;
$$;

drop trigger if exists jobscout_jobs_touch on public.jobscout_jobs;
create trigger jobscout_jobs_touch
  before insert or update on public.jobscout_jobs
  for each row execute function public.jobscout_jobs_touch();

-- Upgrades for tables created before the apply kit and the "skipped" status.
alter table public.jobscout_jobs add column if not exists cv_variant text;
alter table public.jobscout_jobs add column if not exists pitch text;
alter table public.jobscout_jobs drop constraint if exists jobscout_jobs_status_check;
alter table public.jobscout_jobs add constraint jobscout_jobs_status_check
  check (status in ('new','starred','applied','replied','interview','rejected','skipped'));
