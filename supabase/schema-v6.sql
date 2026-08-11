-- ═══════════════════════════════════════════════════════════
-- ARMONÍA — v6 schema addition:
--   1. Device-change approval queue (replaces auto-block with a
--      review-and-approve flow you control)
--   2. A real admin account (hashed password, editable name/emails)
--      instead of the plain ADMIN_PASSWORD env var comparison
-- Run in Supabase SQL Editor after schema.sql through schema-v5.sql.
-- ═══════════════════════════════════════════════════════════

create table if not exists device_change_requests (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null references access_codes(code),
  attempted_device_id text not null,
  ip_hash            text,
  user_agent         text,
  status             text not null default 'pending' check (status in ('pending','approved','denied')),
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz
);
create index if not exists idx_device_requests_status on device_change_requests (status, created_at desc);

create table if not exists admin_account (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null default 'Isaak Matovich',
  login_email                 text not null,
  login_email_verified        boolean not null default false,
  verification_token          text,
  verification_token_expires  timestamptz,
  billing_email               text,
  password_hash               text not null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
-- Only ever one row in this table — it's a single-admin system.
