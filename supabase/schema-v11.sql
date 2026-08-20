-- ═══════════════════════════════════════════════════════════
-- ARMONÍA — v11 schema addition: course updates.
--
-- Whenever admin adds a new lesson, a draft update is auto-generated here
-- with status='pending'. It is NOT visible to students until an admin
-- reviews and publishes it (status='published'). Admin can also write
-- updates manually.
--
-- Unread tracking uses a simple "last seen" timestamp on student_profiles
-- rather than a per-item join table — anything published after a student's
-- last-seen time counts as unread for them. Simple and sufficient for a
-- shared broadcast feed like this.
-- Run in Supabase SQL Editor after schema.sql through schema-v10.sql.
-- ═══════════════════════════════════════════════════════════

create table if not exists course_updates (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  body               text,
  status             text not null default 'pending',
  source             text not null default 'auto',
  related_lesson_id  uuid references lessons(id) on delete set null,
  created_at         timestamptz not null default now(),
  published_at       timestamptz
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'course_updates_status_check') then
    alter table course_updates add constraint course_updates_status_check check (status in ('pending','published'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'course_updates_source_check') then
    alter table course_updates add constraint course_updates_source_check check (source in ('auto','manual'));
  end if;
end $$;

create index if not exists idx_course_updates_status on course_updates (status, published_at desc);

alter table student_profiles add column if not exists updates_last_seen_at timestamptz;
alter table student_profiles add column if not exists banner_url text;
