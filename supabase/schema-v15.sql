-- ═══════════════════════════════════════════════════════════
-- ARMONÍA — v15 schema: products become editable data.
--
-- Until now the catalogue lived in store/catalog.json, a deploy-time file.
-- That made "edit a price in the admin" impossible without a redeploy, so the
-- two tables below move the products and the shipping rules into Postgres.
--
--   store_products   one row per product — name, price, colours, sizes, art,
--                    stock, and the supplier mapping used for fulfilment
--   store_settings   a single row holding shipping fee + free-shipping
--                    threshold, so those are editable too
--
-- Everything is read and written by api/store and api/admin with the
-- service-role key, so RLS is on with no public policies, exactly like v14.
--
-- Safe to run more than once. Run in the Supabase SQL Editor after
-- schema.sql through schema-v14.sql.
-- ═══════════════════════════════════════════════════════════

create table if not exists store_products (
  id                 text primary key,              -- 'connection-hoodie'
  name               text not null,
  short_name         text,
  subtitle           text,
  description        text,
  details            jsonb not null default '[]'::jsonb,
  fit                text,
  badge              text,
  category           text,
  type               text,                          -- drives image path + sizing UI
  price_cents        integer not null check (price_cents >= 0),
  compare_at_cents   integer,                       -- for a strike-through price
  cost_cents         integer,                       -- what the supplier charges us
  colors             jsonb not null default '[]'::jsonb,
  sizes              jsonb not null default '[]'::jsonb,
  images             jsonb not null default '{}'::jsonb,   -- { color: '/store/images/x.webp' }
  back_images        jsonb not null default '{}'::jsonb,   -- windbreaker's second view
  max_per_order      integer not null default 20,
  in_stock           boolean not null default true,
  sort_order         integer not null default 0,
  supplier           text,                          -- 'printful' | 'printkk' | null
  supplier_variants  jsonb not null default '{}'::jsonb,   -- { 'ink|M': sync_variant_id }
  updated_at         timestamptz not null default now()
);

create index if not exists idx_store_products_order on store_products (sort_order, id);

create table if not exists store_settings (
  id                    integer primary key default 1 check (id = 1),
  shipping_fee_cents    integer not null default 600,
  free_shipping_cents   integer not null default 7500,
  updated_at            timestamptz not null default now()
);

insert into store_settings (id) values (1) on conflict (id) do nothing;

alter table store_products enable row level security;
alter table store_settings enable row level security;

-- ── Seed: the six products as they stand today ─────────────────────────────
-- `on conflict do nothing`, so re-running this file never overwrites a price
-- you have since changed in the admin.
insert into store_products
  (id, name, short_name, subtitle, description, badge, category, type, price_cents,
   colors, sizes, images, back_images, details, fit, sort_order)
values
  ('signature-cap', 'The Signature Cap', 'Signature Cap',
   'Premium embroidered cap',
   'A little shade. A lot of character. Our signature cap pairs soft cotton twill with the gold Armonia Connect emblem. An easy finishing touch for whatever your day has in store.',
   'THE ORIGINAL', 'Accessories', 'cap', 2800,
   '["sky","ink","ivory","orange"]'::jsonb, '["One size"]'::jsonb, '{}'::jsonb, '{}'::jsonb,
   '["100% cotton twill","Six-panel shape with a curved brim","Embroidered gold emblem and wordmark","Adjustable back strap • one size fits most"]'::jsonb,
   'An adjustable, everyday fit. The back strap lets you find your own comfort zone.', 1),

  ('everyday-tee', 'The Everyday Tee', 'Everyday Tee',
   'Premium T-shirt',
   'Meet your go-to. A relaxed silhouette, soft heavyweight cotton, and our quietly distinctive embroidered mark. Made to feel just right, from the first coffee to the last conversation.',
   'EVERYDAY FAVORITE', 'Apparel', 'tee', 3400,
   '["sky","ink","ivory","orange"]'::jsonb, '["S","M","L","XL","2XL"]'::jsonb, '{}'::jsonb, '{}'::jsonb,
   '["Heavyweight 100% cotton","Relaxed, unisex silhouette","Small embroidered chest logo","Ribbed crewneck • easy everyday layering"]'::jsonb,
   'A relaxed unisex fit. Choose your usual size for an easy fit, or size up for an oversized look.', 2),

  ('connection-hoodie', 'The Connection Hoodie', 'Connection Hoodie',
   'Premium hoodie',
   'The layer you reach for without thinking. Cozy cotton fleece, a generous hood, and a relaxed shape give this everyday staple a little extra warmth—in every sense.',
   'COZY FALL FAVORITE', 'Apparel', 'hoodie', 6800,
   '["ink","sky","ivory","orange"]'::jsonb, '["S","M","L","XL","2XL"]'::jsonb, '{}'::jsonb, '{}'::jsonb,
   '["Cotton-rich heavyweight fleece","Relaxed, unisex silhouette","Embroidered Armonia Connect chest logo","Kangaroo pocket • ribbed cuffs and hem"]'::jsonb,
   'A comfortably relaxed unisex fit. Choose your regular size, or one size up for extra room.', 3),

  ('connection-windbreaker', 'The Connection Windbreaker', 'Connection Windbreaker',
   'Packable weather-resistant shell',
   'Engineered for crisp mornings and late evenings. A lightweight water-resistant nylon windbreaker featuring our subtle chest emblem on the front and statement Armonia Connect typography across the shoulders.',
   'FALL ESSENTIAL', 'Apparel', 'windbreaker', 8800,
   '["ink","ivory","sky","orange"]'::jsonb, '["S","M","L","XL","2XL"]'::jsonb,
   '{"ink":"/store/images/windbreaker-front-ink.webp","ivory":"/store/images/windbreaker-front-ivory.webp","sky":"/store/images/windbreaker-front-sky.webp","orange":"/store/images/windbreaker-front-orange.webp"}'::jsonb,
   '{"ink":"/store/images/windbreaker-back-ink.webp","ivory":"/store/images/windbreaker-back-ivory.webp","sky":"/store/images/windbreaker-back-sky.webp","orange":"/store/images/windbreaker-back-orange.webp"}'::jsonb,
   '["Water-resistant lightweight nylon shell","Embroidered chest emblem on front left chest","Statement Armonia Connect emblem and lettering across back shoulders","Adjustable bungee hood and elastic storm cuffs"]'::jsonb,
   'True to size with room for light layering. For an oversized fit over thick knitwear, size up.', 4),

  ('connect-stickers', 'The Connect Sticker Set', 'Connect Sticker Set',
   'Logo-shaped metallic vinyl die-cut stickers',
   'Precision contour die-cut to the exact silhouette of the official Armonia Connect emblem. Crafted in durable weather-resistant satin vinyl with brushed metallic gold and silver foil.',
   'METALLIC DIE-CUT', 'Accessories', 'stickers', 800,
   '["ink","ivory"]'::jsonb, '["Set of 2"]'::jsonb,
   '{"ink":"/store/images/stickers-ink.webp","ivory":"/store/images/stickers-ivory.webp"}'::jsonb, '{}'::jsonb,
   '["Contour die-cut exactly to the official logo emblem silhouette","Brushed metallic foil stamped on satin black vinyl","Weather-resistant UV matte laminate coating"]'::jsonb,
   'Approximately 3.2 inches tall, custom die-cut emblem shape.', 5),

  ('connect-picks', 'The Connect Pick Set', 'Connect Pick Set',
   'Six celluloid picks with the emblem',
   'The sound of the collection, in your pocket. Six premium celluloid picks in three gauges — two light for strumming, two medium for everything in between, two heavy for lead lines — each foil-stamped with the Armonia Connect emblem, in a slim pick wallet.',
   'STAGE ESSENTIAL', 'Accessories', 'picks', 1600,
   '["ivory","ink","sky","orange"]'::jsonb, '["Set of 6"]'::jsonb,
   '{"ivory":"/store/images/picks-ivory.webp","ink":"/store/images/picks-ink.webp","sky":"/store/images/picks-sky.webp","orange":"/store/images/picks-orange.webp"}'::jsonb, '{}'::jsonb,
   '["Six picks in three gauges: 2 × .46mm, 2 × .73mm, 2 × 1.0mm","Foil-stamped Armonia Connect emblem on every pick","Standard 351 shape with a smooth, bevelled edge","Slim pick wallet included"]'::jsonb,
   'Standard 351 shape, the shape most players already know. The .46mm bends easily for strumming; the 1.0mm holds its attack for lead work.', 6)
on conflict (id) do nothing;

-- ── Orders learn about fulfilment ─────────────────────────────────────────
-- Tracking and supplier references live on the order itself so the admin can
-- show "where is it" without joining anything.
alter table store_orders add column if not exists fulfilment_status text;  -- null | submitted | failed | shipped
alter table store_orders add column if not exists supplier text;
alter table store_orders add column if not exists supplier_order_id text;
alter table store_orders add column if not exists carrier text;
alter table store_orders add column if not exists tracking_number text;
alter table store_orders add column if not exists tracking_url text;
alter table store_orders add column if not exists shipped_at timestamptz;
alter table store_orders add column if not exists fulfilment_error text;

create index if not exists idx_store_orders_fulfilment on store_orders (fulfilment_status);

-- ── Verify ────────────────────────────────────────────────────────────────
-- select id, name, price_cents, in_stock from store_products order by sort_order;
