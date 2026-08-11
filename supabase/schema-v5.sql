-- ═══════════════════════════════════════════════════════════
-- ARMONÍA — v5 schema addition: permanent device binding
-- Run in Supabase SQL Editor after schema.sql through schema-v4.sql.
--
-- This is stronger than the existing "one active session" rule: once a
-- code is first used, it's permanently tied to that browser/device. A
-- different device trying to use the same code is rejected outright,
-- not just logged out — this is what stops "here, use my code" sharing.
-- ═══════════════════════════════════════════════════════════

alter table access_codes add column if not exists bound_device_id text;
alter table access_codes add column if not exists bound_ip_hash text;
alter table access_codes add column if not exists bound_at timestamptz;
