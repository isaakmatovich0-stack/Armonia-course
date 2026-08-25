-- ═══════════════════════════════════════════════════════════
-- ARMONÍA — v13 schema addition: lesson completion tracking.
--
-- Backs the "mark complete" system and the practice-streak indicator.
-- Streaks are computed on read from distinct completion dates, not stored
-- as a running counter — simpler, and self-corrects if a completion is
-- ever removed.
-- Run in Supabase SQL Editor after schema.sql through schema-v12.sql.
-- ═══════════════════════════════════════════════════════════

create table if not exists lesson_completions (
  id            uuid primary key default gen_random_uuid(),
  code          text not null references access_codes(code) on delete cascade,
  lesson_id     uuid not null references lessons(id) on delete cascade,
  completed_at  timestamptz not null default now(),
  unique (code, lesson_id)
);

create index if not exists idx_lesson_completions_code on lesson_completions (code);
