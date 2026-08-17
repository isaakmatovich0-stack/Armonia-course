-- ═══════════════════════════════════════════════════════════
-- ARMONÍA — v8 schema addition:
--   1. Code types: 'student' (normal, single-session) vs 'classroom'
--      (multi-session, teacher/big-screen use, restricted features)
--   2. Track whether a code came from Stripe or was admin-generated
--   3. School/teacher name fields for classroom accounts
-- Run in Supabase SQL Editor after schema.sql through schema-v7.sql.
-- ═══════════════════════════════════════════════════════════

alter table access_codes add column if not exists code_type text not null default 'student';
alter table access_codes add column if not exists source text not null default 'stripe';

-- keep these constrained to known values without blowing up if re-run
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'access_codes_code_type_check') then
    alter table access_codes add constraint access_codes_code_type_check check (code_type in ('student','classroom'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'access_codes_source_check') then
    alter table access_codes add constraint access_codes_source_check check (source in ('stripe','admin'));
  end if;
end $$;

alter table student_profiles add column if not exists school_name text;
alter table student_profiles add column if not exists teacher_name text;
