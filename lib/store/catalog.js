// Catalog, pricing and shipping rules for the Armonia Connect store.
//
// The single source of truth is store/catalog.json — the same file the build
// script writes into public/store/index.html. Every order is priced here, on
// the server, from that file: the browser can change prices in devtools all it
// likes and Stripe will still be asked for the real amount.
//
// Editing prices / colours / products: change store/catalog.json (or re-export
// from Armonia Studio with `node store/build-store.mjs --export …`) and
// redeploy. Nothing else needs touching.

import fs from 'node:fs';
import path from 'node:path';

const CATALOG_PATH = path.resolve(process.cwd(), 'store/catalog.json');

export const SHIPPING = {
  countries: ['US'],
  standardCents: Number(process.env.STORE_SHIPPING_FEE_CENTS || 600),
  freeOverCents: Number(process.env.STORE_FREE_SHIPPING_CENTS || 7500),
  estimate: '2–4 business days',
  taxNote: 'Sales tax is calculated at checkout based on your shipping address.',
  currency: 'usd',
};

const DEFAULT_MAX_PER_LINE = 20;
const FOUNDERS_MAX_PER_LINE = 10; // "Founders Limited" sky colour is capped, matching the storefront

let cache = null;

export function loadCatalog() {
  if (cache) return cache;
  const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const products = (raw.products || []).map((product) => ({
    id: product.id,
    name: product.name,
    shortName: product.shortName || product.name,
    type: product.type || 'custom',
    subtitle: product.subtitle || '',
    priceCents: Math.round(Number(product.price) * 100),
    colors: product.colors || [],
    sizes: product.sizes || [],
    images: product.images || {},
    backImages: product.backImages || {},
  }));
  cache = {
    products,
    byId: new Map(products.map((product) => [product.id, product])),
    colors: raw.colors || {},
    featuredId: raw.featuredId || (products[0] && products[0].id),
    upsellId: raw.upsellId || null,
    site: raw.site || {},
    brand: raw.brand || {},
  };
  return cache;
}

/** Reset the in-memory catalog cache (used by the local dev server). */
export function clearCatalogCache() {
  cache = null;
}

export function publicCatalog() {
  const catalog = loadCatalog();
  return {
    products: catalog.products.map((product) => ({
      id: product.id,
      name: product.name,
      shortName: product.shortName,
      type: product.type,
      priceCents: product.priceCents,
      colors: product.colors,
      sizes: product.sizes,
      maxPerOrder: maxFor(product, product.colors[0]),
      inStock: true,
    })),
    colors: catalog.colors,
    featuredId: catalog.featuredId,
    upsellId: catalog.upsellId,
    shipping: publicShipping(),
    currency: 'USD',
    checkoutLive: isCheckoutLive(),
  };
}

export function publicShipping() {
  return {
    countries: SHIPPING.countries,
    standardShippingCents: SHIPPING.standardCents,
    freeShippingThresholdCents: SHIPPING.freeOverCents,
    estimate: SHIPPING.estimate,
    taxNote: SHIPPING.taxNote,
    currency: SHIPPING.currency,
  };
}

/**
 * Checkout needs a Stripe secret key. Without it the store still browses,
 * adds to bag and shows live prices — it just refuses to take money.
 */
export function isCheckoutLive() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function maxFor(product, color) {
  if (color && String(color).toLowerCase() === 'sky') return Math.min(FOUNDERS_MAX_PER_LINE, DEFAULT_MAX_PER_LINE);
  return DEFAULT_MAX_PER_LINE;
}

export function lineKey(productId, color, size) {
  return `${productId}|${color}|${size}`;
}

/**
 * Normalise untrusted bag input.
 * Returns { items, error } where items is a clean array of
 * { productId, color, size, quantity }.
 */
export function normalizeItems(input) {
  if (!Array.isArray(input)) return { items: [], error: null };
  const catalog = loadCatalog();
  const seen = new Map();

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const product = catalog.byId.get(String(raw.productId || raw.id || ''));
    if (!product) continue;

    const color = String(raw.color || product.colors[0] || '');
    if (!product.colors.includes(color)) continue;

    const size = String(raw.size || product.sizes[0] || '');
    if (!product.sizes.includes(size)) continue;

    const requested = Math.floor(Number(raw.quantity));
    if (!Number.isFinite(requested) || requested < 1) continue;

    const quantity = Math.min(requested, maxFor(product, color));
    const key = lineKey(product.id, color, size);
    const existing = seen.get(key);
    if (existing) existing.quantity = Math.min(maxFor(product, color), existing.quantity + quantity);
    else seen.set(key, { productId: product.id, color, size, quantity });
  }

  return { items: [...seen.values()], error: null };
}

/**
 * Turn items into priced lines plus bag totals.
 * `promoCode` is whatever the customer typed; `promoRow` is the matching row
 * from store_promo_codes (or null). A code only ever discounts when the row
 * exists and is still valid.
 */
export function priceBag(items, { promoCode = null, promoRow = null } = {}) {
  const catalog = loadCatalog();

  const lines = items
    .map((item) => {
      const product = catalog.byId.get(item.productId);
      if (!product) return null;
      const unitPriceCents = product.priceCents;
      const quantity = item.quantity;
      return {
        key: lineKey(item.productId, item.color, item.size),
        productId: product.id,
        name: product.name,
        shortName: product.shortName,
        type: product.type,
        color: item.color,
        colorKey: item.color,
        colorName: (catalog.colors[item.color] || {}).name || item.color,
        size: item.size,
        quantity,
        unitPriceCents,
        lineTotalCents: unitPriceCents * quantity,
        maxQuantity: maxFor(product, item.color),
      };
    })
    .filter(Boolean);

  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const discount = applyPromo(promoCode, subtotalCents, promoRow);
  const discountedSubtotal = Math.max(0, subtotalCents - discount.amountCents);
  const freeShipping = discountedSubtotal >= SHIPPING.freeOverCents || discount.freeShipping;
  const shippingCents = lines.length === 0 || freeShipping ? 0 : SHIPPING.standardCents;

  return {
    lines,
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalCents,
    discountCents: discount.amountCents,
    shippingCents,
    totalCents: Math.max(0, discountedSubtotal + shippingCents),
    freeShippingThresholdCents: SHIPPING.freeOverCents,
    shipping: {
      amountCents: shippingCents,
      free: shippingCents === 0,
      label: freeShipping ? 'Free standard shipping' : 'Standard shipping',
      estimate: SHIPPING.estimate,
    },
    promo: discount.promo,
    currency: 'USD',
    live: isCheckoutLive(),
  };
}

/**
 * Validate a promo code against the `store_promo_codes` table.
 * `code` may be null; `row` is the database row (or null when it doesn't exist).
 */
export function applyPromo(code, subtotalCents, row = null) {
  if (!code) return { amountCents: 0, freeShipping: false, promo: null, valid: false };
  const normalized = String(code).trim().toUpperCase();
  const invalid = (message) => ({
    amountCents: 0,
    freeShipping: false,
    valid: false,
    promo: { code: normalized, valid: false, message },
  });

  if (!row || row.code.toUpperCase() !== normalized) return invalid('That code isn’t recognised.');
  if (row.active === false) return invalid('That code is no longer active.');
  const now = Date.now();
  if (row.starts_at && new Date(row.starts_at).getTime() > now) return invalid('That code isn’t active yet.');
  if (row.ends_at && new Date(row.ends_at).getTime() < now) return invalid('That code has expired.');
  if (row.max_uses && row.times_used >= row.max_uses) return invalid('That code has been fully claimed.');
  if (row.min_subtotal_cents && subtotalCents < row.min_subtotal_cents) {
    return invalid(`Valid on orders over ${formatMoney(row.min_subtotal_cents)}.`);
  }

  let amountCents = 0;
  let freeShipping = false;
  if (row.kind === 'percent') amountCents = Math.round(subtotalCents * (Number(row.value) / 100));
  else if (row.kind === 'amount') amountCents = Math.min(subtotalCents, Math.round(Number(row.value)));
  else if (row.kind === 'free_shipping') freeShipping = true;

  return {
    amountCents,
    freeShipping,
    valid: true,
    promo: {
      code: normalized,
      valid: true,
      description: row.description || (row.kind === 'free_shipping' ? 'Free standard shipping' : 'Discount applied'),
      amountCents,
      freeShipping,
    },
  };
}

export function formatMoney(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
}

/** Product images for Stripe receipts (absolute URLs; Stripe requires https). */
export function productImageUrls(product, origin) {
  const base = process.env.SITE_URL || origin || 'https://www.armoniaconnect.com';
  const color = product.colors[0];
  const relative =
    (product.images && product.images[color]) ||
    (product.type === 'windbreaker' ? `/store/images/windbreaker-front-${color}.webp` : `/store/images/${product.type}-${color}.webp`);
  if (!relative) return [];
  return [`${base.replace(/\/$/, '')}${relative.startsWith('/store') ? relative : `/store/images/${relative.split('/').pop()}`}`];
}
