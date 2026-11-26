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

-- Fixed-window per-edge-IP checkout limiting. Hashes are keyed by an environment
-- secret before arriving here; raw addresses are never stored. The atomic
-- upsert serializes concurrent attempts for the same client and time window.
create table if not exists public.transcription_checkout_limits (
  client_hash text not null,
  window_start timestamptz not null,
  attempts integer not null,
  primary key (client_hash, window_start)
);
create index if not exists transcription_checkout_limits_window_idx on public.transcription_checkout_limits (window_start);
alter table public.transcription_checkout_limits enable row level security;
create or replace function public.transcription_checkout_rate_limit(p_client_hash text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n integer;
  window_time timestamptz := to_timestamp(floor(extract(epoch from now()) / 900) * 900);
begin
  if p_client_hash is null or p_client_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  insert into public.transcription_checkout_limits as limits (client_hash, window_start, attempts)
    values (p_client_hash, window_time, 1)
    on conflict on constraint transcription_checkout_limits_pkey do update set attempts = limits.attempts + 1
    returning attempts into n;
  if random() < 0.01 then
    delete from public.transcription_checkout_limits where window_start < now() - interval '1 day';
  end if;
  return n <= 10;
end;
$$;
revoke all on function public.transcription_checkout_rate_limit(text) from public, anon, authenticated;
grant execute on function public.transcription_checkout_rate_limit(text) to service_role;
