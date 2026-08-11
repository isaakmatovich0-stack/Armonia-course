-- ═══════════════════════════════════════════════════════════
-- ARMONÍA — v4 schema addition: Community board
-- Run in Supabase SQL Editor after schema.sql, schema-v2.sql, schema-v3.sql.
-- ═══════════════════════════════════════════════════════════

create table if not exists community_posts (
  id          uuid primary key default gen_random_uuid(),
  author_code text not null references access_codes(code),
  body        text not null,
  image_url   text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_community_posts_created on community_posts (created_at desc);

-- One row per (post, student) — this is what makes "like once, click again
-- to unlike" enforceable: the unique constraint prevents a double-like,
-- and the API just inserts-or-deletes this row to toggle.
create table if not exists community_likes (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references community_posts(id) on delete cascade,
  author_code text not null references access_codes(code),
  created_at  timestamptz not null default now(),
  unique (post_id, author_code)
);

create table if not exists community_replies (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references community_posts(id) on delete cascade,
  author_code text not null references access_codes(code),
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_community_replies_post on community_replies (post_id, created_at);
