-- ═══════════════════════════════════════════════════════════
-- ARMONÍA — v7 schema addition:
--   1. Cover images for lessons (per-lesson) and instruments (portal cards)
--   2. Images on announcements
--   3. Mock auditions (admin-scheduled, student sign-up)
-- Run in Supabase SQL Editor after schema.sql through schema-v6.sql.
-- ═══════════════════════════════════════════════════════════

alter table lessons add column if not exists cover_image_url text;
alter table announcements add column if not exists image_url text;

-- Instrument portal-card cover images are stored in site_content using
-- keys like 'instrument.vihuela.cover_url' — no new table needed, the
-- existing key/value store handles it.

create table if not exists mock_auditions (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  event_date  timestamptz not null,
  zoom_link   text,
  created_at  timestamptz not null default now()
);

create table if not exists mock_audition_signups (
  id               uuid primary key default gen_random_uuid(),
  mock_audition_id uuid not null references mock_auditions(id) on delete cascade,
  code             text not null references access_codes(code),
  agreed_at        timestamptz not null default now(),
  unique (mock_audition_id, code)
);
