-- Transcription sales. Apply deliberately before enabling checkout.
-- Files are private and never belong in site_content or a public bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('transcription-purchases', 'transcription-purchases', false, 3145728, array['application/pdf'])
on conflict (id) do nothing;

create table if not exists public.transcription_sale_products (
  piece_id text primary key,
  price_cents integer not null check (price_cents between 50 and 1000000),
  asset_path text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.transcription_sale_orders (
  id uuid primary key,
  piece_id text not null,
  piece_title text not null,
  price_cents integer not null check (price_cents between 50 and 1000000),
  asset_path text not null,
  stripe_session_id text unique,
  state text not null default 'awaiting_payment' check (state in ('awaiting_payment', 'sending', 'sent', 'review')),
  customer_email text,
  resend_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists transcription_sale_orders_state_idx on public.transcription_sale_orders (state, updated_at desc);
alter table public.transcription_sale_products enable row level security;
alter table public.transcription_sale_orders enable row level security;
-- Deliberately no anon/authenticated policies. Only server-side service role
-- may read/write orders, private asset paths, or private storage objects.
-- This does not change existing buckets or their policies.
