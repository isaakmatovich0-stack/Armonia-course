-- The first version of this table has already been installed but is not used
-- in production. Apply these additions before deploying the cart-scoped guard.
-- Existing NULL cart IDs, if any, must be reconciled before release.
create table if not exists public.store_checkout_attempts (
  attempt_key text primary key,
  stripe_session_id text unique,
  created_at timestamptz not null default now()
);
alter table public.store_checkout_attempts enable row level security;
alter table public.store_checkout_attempts add column if not exists cart_id text;
alter table public.store_checkout_attempts add column if not exists params_hash text;
alter table public.store_checkout_attempts add column if not exists previous_paid_session_id text;
create unique index if not exists store_checkout_attempts_cart_id_key on public.store_checkout_attempts (cart_id);
