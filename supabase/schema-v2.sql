-- ═══════════════════════════════════════════════════════════
-- ARMONÍA — v2 schema additions
-- Run this in Supabase SQL Editor AFTER schema.sql (it's additive,
-- safe to run even if you already ran schema.sql once).
-- ═══════════════════════════════════════════════════════════

-- Lets us enforce "one active session per code" (piracy protection).
-- When a code logs in, we stamp a new session_token here. Any browser
-- holding an older token gets logged out next time it checks in.
alter table access_codes add column if not exists current_session_token text;
alter table access_codes add column if not exists session_started_at timestamptz;

-- Student profile, filled out once after their first login.
create table if not exists student_profiles (
  code             text primary key references access_codes(code),
  name             text,
  instrument       text,       -- vihuela / guitarra / guitarra de golpe / guitarrón
  experience_level text,       -- beginner / intermediate / advanced, student's own words
  years_playing    text,
  bio              text,
  photo_url        text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Direct messages between a student (identified by code) and the maestro.
-- sender is either 'student' or 'maestro'.
create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  code       text not null references access_codes(code),
  sender     text not null check (sender in ('student','maestro')),
  body       text not null,
  created_at timestamptz not null default now(),
  read_by_maestro boolean not null default false,
  read_by_student boolean not null default false
);

create index if not exists idx_messages_code on messages (code, created_at);

-- Announcements broadcast to every enrolled student.
create table if not exists announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  created_at timestamptz not null default now()
);
