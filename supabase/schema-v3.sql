-- ═══════════════════════════════════════════════════════════
-- ARMONÍA — v3 schema addition: lessons CMS
-- Run in Supabase SQL Editor after schema.sql and schema-v2.sql.
-- This replaces lib/lessonLibrary.js as the source of truth for
-- lesson content — you'll manage lessons from /admin/ instead of
-- editing code.
-- ═══════════════════════════════════════════════════════════

create table if not exists lessons (
  id             uuid primary key default gen_random_uuid(),
  instrument_key text not null check (instrument_key in ('vihuela','guitarra','guitarra-de-golpe','guitarron')),
  section        text not null check (section in ('etude','practice_technique','performance','etude_fifths')),
  title          text not null,
  description    text,
  video_url      text,
  soundslice_id  text,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_lessons_instrument on lessons (instrument_key, section, sort_order);

-- Shared resources (chord books, MIDI tracks) — same idea, admin-editable.
create table if not exists resources (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('chord_book','midi_track')),
  title      text not null,
  file_url   text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Editable site text (headlines, taglines, page copy) — powers the
-- "Edit Text" feature in the admin panel so Isaak can change on-site
-- wording without touching code.
create table if not exists site_content (
  key        text primary key,     -- e.g. 'announcements.title', 'credits.body'
  value      text not null,
  updated_at timestamptz not null default now()
);
