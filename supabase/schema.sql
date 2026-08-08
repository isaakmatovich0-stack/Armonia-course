-- ═══════════════════════════════════════════════════════════
-- ARMONÍA — Course Access Database Schema
-- Run this once in Supabase: Project → SQL Editor → paste → Run
-- ═══════════════════════════════════════════════════════════

create table if not exists access_codes (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,          -- e.g. "ARMONIA-7X2P-9KQF"
  email           text not null,                  -- buyer's email from Stripe
  name            text,                            -- buyer's name from Stripe, if provided
  stripe_session_id text unique,                  -- ties code back to the exact payment
  amount_paid     integer,                         -- in cents, e.g. 10000 = $100.00
  created_at      timestamptz not null default now(),
  redeemed_at     timestamptz,                     -- null until they first log into the course site
  redeemed_count  integer not null default 0,      -- how many times the code has been used to log in
  last_login_at   timestamptz,
  revoked         boolean not null default false   -- flip to true to cut off access (refunds, disputes)
);

create index if not exists idx_access_codes_code on access_codes (code);
create index if not exists idx_access_codes_email on access_codes (email);

-- Simple session log so you can see login activity / spot shared codes
create table if not exists login_events (
  id         uuid primary key default gen_random_uuid(),
  code       text not null references access_codes(code),
  ip_hash    text,           -- hashed, not raw IP, for basic abuse detection
  user_agent text,
  created_at timestamptz not null default now()
);

-- Contact form submissions (kept as a backup even though they're also emailed to you)
create table if not exists contact_messages (
  id          uuid primary key default gen_random_uuid(),
  first_name  text not null,
  last_name   text not null,
  email       text not null,
  subject     text not null,
  message     text not null,
  created_at  timestamptz not null default now()
);
