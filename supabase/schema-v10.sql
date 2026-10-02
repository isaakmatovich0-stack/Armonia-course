-- ═══════════════════════════════════════════════════════════
-- ARMONÍA — v10 schema addition: student-to-student direct messages.
--
-- Access codes double as login credentials, so they must never be exposed
-- to other students (only to the owning student and to admin). This adds a
-- separate, safe-to-share public_id per student profile, and a new
-- direct_messages table keyed on that public_id instead of the raw code.
--
-- The existing student <-> maestro conversation (the "messages" table) is
-- untouched — this is a parallel system for student <-> student DMs.
-- Run in Supabase SQL Editor after schema.sql through schema-v9.sql.
-- ═══════════════════════════════════════════════════════════

alter table student_profiles add column if not exists public_id uuid not null default gen_random_uuid();
create unique index if not exists idx_student_profiles_public_id on student_profiles (public_id);

create table if not exists direct_messages (
  id                   uuid primary key default gen_random_uuid(),
  conversation_id      text not null,   -- deterministic: the two participants' public_ids, sorted and joined
  sender_public_id     uuid not null,
  recipient_public_id  uuid not null,
  body                 text not null,
  created_at           timestamptz not null default now(),
  read                 boolean not null default false
);

create index if not exists idx_dm_conversation on direct_messages (conversation_id, created_at);
create index if not exists idx_dm_recipient_unread on direct_messages (recipient_public_id, read);
