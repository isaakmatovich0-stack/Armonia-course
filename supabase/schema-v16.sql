-- ════════════════════════════════════════════════════════════════════════
--  schema-v16 — seasonal decoration setting
-- ════════════════════════════════════════════════════════════════════════
--
-- The storefront's seasonal decorations (the falling snow and the trees, at
-- the time of writing) were previously switched by a value baked into the
-- page at build time. That made "turn it off" a code change, which is exactly
-- what it must not be: the person who owns the shop should be able to turn a
-- season off on a Tuesday evening without a deploy.
--
-- So the switch moves to the database, next to the shipping numbers:
--
--   decorations_on  master switch for every seasonal effect
--   decoration      which season's artwork to draw ('christmas' for now)
--   decoration_text  the seasonal banner's copy, so the season's message does
--                   not need a code change either
--
-- WHY THE MASTER SWITCH IS `decorations_on` AND NOT `fall_flares`:
-- the old flag was named after one particular season. A column called
-- `fall_flares` that has to stay `false` in July is a trap for whoever reads
-- this next. Off is off, whatever the season is called.
--
-- Every column is nullable with a default, and nothing else in the schema
-- changes, so running this file twice is harmless.

alter table store_settings
  add column if not exists decorations_on   boolean not null default false,
  add column if not exists decoration       text not null default 'christmas',
  add column if not exists decoration_text  text not null default '';

-- The season is off by default. A shop that has never been told what season it
-- is in should look like a shop, not like a shop that guessed wrong.
update store_settings set decorations_on = false where decorations_on is null;

-- Deliberately no seed of a banner message: the storefront falls back to a
-- sensible Christmas line in code, so this column can stay empty until
-- somebody wants to write their own.

-- Reading is already open through the public store API (which uses the
-- service-role key server-side). No new policies are needed for the
-- storefront, and the admin panel already goes through /api/admin, which is
-- gated by requireAdmin.
