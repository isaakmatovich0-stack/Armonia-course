-- ═══════════════════════════════════════════════════════════
-- ARMONÍA — v12 schema addition: login rate limiting.
--
-- Tracks failed access-code attempts by IP hash (same hashing already used
-- elsewhere for device-binding). After 4 failed attempts within 15 minutes
-- from the same IP, further attempts are blocked with a clear message.
-- Run in Supabase SQL Editor after schema.sql through schema-v11.sql.
-- ═══════════════════════════════════════════════════════════

create table if not exists failed_login_attempts (
  id         uuid primary key default gen_random_uuid(),
  ip_hash    text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_failed_login_ip_time on failed_login_attempts (ip_hash, created_at desc);
