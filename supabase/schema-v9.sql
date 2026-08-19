-- ═══════════════════════════════════════════════════════════
-- ARMONÍA — v9 schema addition:
--   Adds 'sheet_music' as a valid resources.kind, alongside the
--   existing 'chord_book' and 'midi_track'. Same table, same
--   course-resources storage bucket — no new tables needed.
-- Run in Supabase SQL Editor after schema.sql through schema-v8.sql.
-- ═══════════════════════════════════════════════════════════

alter table resources drop constraint if exists resources_kind_check;
alter table resources add constraint resources_kind_check
  check (kind in ('chord_book', 'midi_track', 'sheet_music'));
