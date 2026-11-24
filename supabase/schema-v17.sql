-- Optional retail prices in cents by exact colour and size (e.g. Black|2XL).
-- Unlisted variants use price_cents. Existing products keep their flat price.
alter table public.store_products
  add column if not exists variant_prices jsonb not null default '{}'::jsonb;
