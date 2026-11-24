-- Durable guard for retrying the same cart checkout without creating another
-- Stripe session. No customer or payment details are stored in this table.
create table if not exists public.store_checkout_attempts (
  attempt_key text primary key,
  stripe_session_id text unique,
  created_at timestamptz not null default now()
);
alter table public.store_checkout_attempts enable row level security;
