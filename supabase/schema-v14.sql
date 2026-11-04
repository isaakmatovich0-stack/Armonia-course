-- ═══════════════════════════════════════════════════════════
-- ARMONÍA — v14 schema addition: the merch store.
--
-- Adds the five tables the storefront needs:
--
--   store_carts              one row per shopping bag (keyed by an opaque id
--                            held in an HttpOnly cookie)
--   store_checkout_sessions  what we asked Stripe to charge, for reconciliation
--   store_orders             one row per paid order — the order book
--   store_promo_codes        discount codes (percent / fixed / free shipping)
--   store_subscribers        newsletter signups from the store footer
--
-- Everything here is written and read by api/store/[...slug].js with the service-role
-- key, so RLS is enabled with no public policies: the anon key cannot touch
-- any of it. Safe to run more than once.
-- Run in Supabase SQL Editor after schema.sql through schema-v13.sql.
-- ═══════════════════════════════════════════════════════════

-- ── Shopping bags ──────────────────────────────────────────
create table if not exists store_carts (
  id          text primary key,
  items       jsonb not null default '[]'::jsonb,
  promo_code  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_store_carts_updated on store_carts (updated_at desc);

-- ── Checkout sessions (one per "Pay" click) ────────────────
create table if not exists store_checkout_sessions (
  id                uuid primary key default gen_random_uuid(),
  stripe_session_id text unique not null,
  cart_id           text,
  items             jsonb not null default '[]'::jsonb,
  amount_total      integer,
  promo_code        text,
  status            text not null default 'open',   -- open | expired | paid
  created_at        timestamptz not null default now()
);

create index if not exists idx_store_checkout_sessions_created on store_checkout_sessions (created_at desc);

-- ── Orders ─────────────────────────────────────────────────
create table if not exists store_orders (
  id                      uuid primary key default gen_random_uuid(),
  number                  text unique not null,
  stripe_session_id       text unique not null,
  stripe_payment_intent_id text,
  email                   text,
  name                    text,
  phone                   text,
  amount_subtotal         integer,
  amount_shipping         integer,
  amount_tax              integer,
  amount_discount         integer not null default 0,
  amount_total            integer,
  currency                text not null default 'usd',
  items                   jsonb not null default '[]'::jsonb,
  shipping_address        jsonb,
  cart_id                 text,
  promo_code              text,
  status                  text not null default 'paid',  -- paid | refunded | cancelled
  paid_at                 timestamptz,
  created_at              timestamptz not null default now()
);

create index if not exists idx_store_orders_created on store_orders (created_at desc);
create index if not exists idx_store_orders_email on store_orders (lower(email));

-- ── Promo codes ────────────────────────────────────────────
create table if not exists store_promo_codes (
  code                text primary key,
  kind                text not null default 'percent' check (kind in ('percent', 'amount', 'free_shipping')),
  value               numeric not null default 0,   -- percent 0-100, or cents for 'amount'
  description         text,
  active              boolean not null default true,
  min_subtotal_cents  integer not null default 0,
  max_uses            integer,
  times_used          integer not null default 0,
  starts_at           timestamptz,
  ends_at             timestamptz,
  created_at          timestamptz not null default now()
);

-- ── Newsletter ─────────────────────────────────────────────
create table if not exists store_subscribers (
  id              uuid primary key default gen_random_uuid(),
  email           text unique not null,
  source          text,
  subscribed_at   timestamptz not null default now(),
  unsubscribed_at timestamptz
);

-- ── Lock everything down: service-role only ────────────────
alter table store_carts             enable row level security;
alter table store_checkout_sessions enable row level security;
alter table store_orders            enable row level security;
alter table store_promo_codes       enable row level security;
alter table store_subscribers       enable row level security;

-- A starter code so the discount field on the cart is testable on day one.
insert into store_promo_codes (code, kind, value, description, min_subtotal_cents)
values ('WELCOME10', 'percent', 10, '10% off your first order', 0)
on conflict (code) do nothing;
