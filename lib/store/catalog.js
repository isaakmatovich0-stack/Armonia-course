// Catalog, pricing and shipping rules for the Armonia Connect store.
//
// Products come from the `store_products` table (schema-v15), so the admin can
// change a price and have it take effect immediately. store/catalog.json is the
// fallback: it is what the build script writes into public/store/index.html, and
// it is still what serves prices if the database has not been migrated yet or
// cannot be reached. Either way the file is the *design* source of truth and the
// table is the *operational* one.
//
// Every order is priced here, on the server. The browser can change prices in
// devtools all it likes and Stripe will still be asked for the real amount —
// that invariant is why this module is the only place prices are computed.

import fs from 'node:fs';
import path from 'node:path';
import { listProducts, getSettings, getDecorationSettings, decorationDefaults } from './db.js';
import { resolveColourName, slugForColour } from './colour-names.js';

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

const CACHE_TTL_MS = 15_000;
let cache = null;
let cacheAt = 0;
let inflight = null;

/** Map a store_products row onto the shape the rest of the store expects. */
function productFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name || row.name,
    type: row.type || 'custom',
    subtitle: row.subtitle || '',
    description: row.description || '',
    details: Array.isArray(row.details) ? row.details : [],
    fit: row.fit || '',
    badge: row.badge || '',
    category: row.category || '',
    priceCents: Math.round(Number(row.price_cents) || 0),
    compareAtCents: row.compare_at_cents ?? null,
    costCents: row.cost_cents ?? null,
    colors: Array.isArray(row.colors) ? row.colors : [],
    sizes: Array.isArray(row.sizes) ? row.sizes : [],
    images: row.images || {},
    backImages: row.back_images || {},
    maxPerOrder: row.max_per_order ?? DEFAULT_MAX_PER_LINE,
    inStock: row.in_stock !== false,
    supplier: row.supplier || null,
    supplierVariants: row.supplier_variants || {},
  };
}

/** Build the in-memory catalog from the JSON file — the fallback path. */
function catalogFromFile() {
  const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const products = (raw.products || []).map((product) => ({
    id: product.id,
    name: product.name,
    shortName: product.shortName || product.name,
    type: product.type || 'custom',
    subtitle: product.subtitle || '',
    description: product.description || '',
    details: product.details || [],
    fit: product.fit || '',
    badge: product.badge || '',
    category: product.category || '',
    priceCents: Math.round(Number(product.price) * 100),
    compareAtCents: null,
    costCents: null,
    colors: product.colors || [],
    sizes: product.sizes || [],
    images: product.images || {},
    backImages: product.backImages || {},
    maxPerOrder: product.maxPerOrder ?? DEFAULT_MAX_PER_LINE,
    inStock: true,
    supplier: null,
    supplierVariants: {},
  }));
  return { raw, products };
}

// Swatch colours for the blank names Printful actually uses. Without these a
// synced colour renders as a neutral placeholder, which reads as "broken image"
// to a shopper rather than "we do not know this one yet".
const PRINTFUL_COLOUR_HEX = {
  black: '#1d1f20',
  // Printful really does sell an "Ink Black" on some blanks, and the old
  // catalogue used `ink` as its black. Same colour, so no swatch is invented.
  ink: '#283033',
  white: '#f4f2ec',
  natural: '#e8e0cf',
  ivory: '#eeece4',
  cream: '#efe9d8',
  'heather grey': '#b3b3b0',
  'sport grey': '#a8a9a6',
  'heather dust': '#d8d2c4',
  navy: '#232f3e',
  'navy blue': '#232f3e',
  forest: '#2c3b2d',
  'forest green': '#2c3b2d',
  charcoal: '#3a3d3f',
  'charcoal heather': '#4a4d4f',
  sport: '#4a4d4f',
  maroon: '#5a2430',
  'burgundy maroon': '#5a2430',
  burgundy: '#5a2430',
  red: '#8c2d0b',
  'burnt orange': '#8c2d0b',
  orange: '#8c2d0b',
  sand: '#d9c9ac',
  'sky blue': '#a9c8dc',
  sky: '#a9c8dc',
  'light blue': '#a9c8dc',
  olive: '#5d6047',
  khaki: '#c3b091',
};

const prettyColour = (key) =>
  String(key).replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function assemble(raw, products, settings) {
  const shipping = settings
    ? {
        ...SHIPPING,
        standardCents: Number(settings.shipping_fee_cents ?? SHIPPING.standardCents),
        freeOverCents: Number(settings.free_shipping_cents ?? SHIPPING.freeOverCents),
      }
    : SHIPPING;
  // Colours live in store/catalog.json, but the products' colours come from the
  // database — and after a Printful sync they will not match: Printful names
  // blanks "Black", "Natural", "Sport Grey", where the catalogue used to invent
  // "Founders Limited". The storefront reads colors[key].name and .hex for every
  // swatch, so this guarantees every referenced colour exists.
  //
  // Only referenced colours are published. A colour nobody sells is dead weight
  // in the API response, and worse, it makes the store look like it stocks
  // things it does not.
  // The database still holds the old lowercase keys ("navy-blue") because the
  // admin's colour editor wrote them before colours became Printful's names.
  // The storefront builds its picker from store/catalog.json ("Navy Blue"), and
  // the bag endpoint validates against this list — so without normalisation the
  // two disagree and adding an item is refused with "That colour is not
  // available." Normalising here means the split is harmless whether or not a
  // sync has run.
  for (const product of products) {
    if (!Array.isArray(product.colors)) continue;
    const canonical = [];
    for (const key of product.colors) {
      const resolved = resolveColourName(key);
      const name = resolved ? resolved.name : key;
      if (!canonical.includes(name)) canonical.push(name);
    }
    product.colors = canonical;
    // An image map keyed by the old spelling would stop matching its colour.
    if (product.images && typeof product.images === 'object') {
      const next = {};
      for (const [key, value] of Object.entries(product.images)) {
        const resolved = resolveColourName(key);
        next[resolved ? resolved.name : key] = value;
      }
      product.images = next;
    }
  }

  const colors = {};
  for (const product of products) {
    for (const key of product.colors || []) {
      if (colors[key]) continue;
      const defined = (raw.colors || {})[key];
      if (defined && defined.hex) { colors[key] = defined; continue; }
      // Printful names colours "Burgundy Maroon", not "burgundy-maroon". The
      // table below is keyed by the lowercase form so both spellings resolve,
      // and it now covers every colour the catalogue actually sells — the old
      // one was missing "burgundy maroon", which is why that swatch was grey.
      const lower = String(key).toLowerCase();
      const known = PRINTFUL_COLOUR_HEX[lower] || PRINTFUL_COLOUR_HEX[lower.replace(/[^a-z]/g, '')];
      colors[key] = {
        name: (defined && defined.name) || prettyColour(key),
        hex: known || '#cdc8bd',
        // Flagged so the admin can say "this swatch is a guess" rather than
        // showing a confident colour we made up. The gate in store/check.mjs
        // fails the build when a colour we sell has no swatch.
        undefined: !known,
      };
    }
  }

  // featuredId / upsellId are merchandising pointers into the product list.
  // They outlive the products they point at: the catalogue replacement deleted
  // "signature-cap" while the JSON still named it, so the hero rendered a
  // product that no longer existed. Resolve them here, against what is
  // actually for sale, and fall back rather than trusting the file.
  const ids = new Set(products.map((product) => product.id));
  const featuredId = ids.has(raw.featuredId) ? raw.featuredId : (products[0] && products[0].id) || null;
  const upsellId = ids.has(raw.upsellId) && raw.upsellId !== featuredId ? raw.upsellId : null;

  return {
    products,
    byId: new Map(products.map((product) => [product.id, product])),
    colors,
    featuredId,
    upsellId,
    site: raw.site || {},
    brand: raw.brand || {},
    shipping,
    decoration: (settings && settings.decoration) || decorationDefaults(),
  };
}

/**
 * Load the catalog, cheapest path first.
 *
 * Synchronous callers get the cached value (or the JSON file) — the storefront
 * and the bag both need a catalog on the first tick. `refreshCatalog()` is the
 * async version that reads the database, and is what the API routes await.
 */
export function loadCatalog() {
  if (cache) return cache;
  const { raw, products } = catalogFromFile();
  cache = assemble(raw, products, null);
  cacheAt = Date.now();
  return cache;
}

/**
 * Read the season switch and fold it into the cached catalogue.
 *
 * Called on the storefront's own read paths. Cheap (one narrow row), and it has
 * to happen per request rather than at build time — the whole point of the
 * admin switch is that it takes effect without a deploy.
 */
export async function refreshDecoration() {
  try {
    const decoration = await getDecorationSettings();
    if (cache) cache.decoration = decoration;
    return decoration;
  } catch (err) {
    console.warn(`[catalog] decoration setting unavailable: ${err.message}`);
    if (cache) cache.decoration = { ...decorationDefaults(), available: false };
    return cache ? cache.decoration : { ...decorationDefaults(), available: false };
  }
}

/** Read the database and repopulate the cache. Falls back to the file. */
export async function refreshCatalog({ force = false } = {}) {
  if (!force && cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const { raw } = catalogFromFile();
    let rows = null;
    let settings = null;
    try {
      [rows, settings] = await Promise.all([listProducts(), getSettings()]);
    } catch (err) {
      console.warn(`[catalog] falling back to store/catalog.json: ${err.message}`);
    }
    const products = rows && rows.length ? rows.map(productFromRow) : catalogFromFile().products;
    cache = assemble(raw, products, settings);
    cacheAt = Date.now();
    return cache;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Reset the in-memory catalog cache (used by the local dev server and admin writes). */
export function clearCatalogCache() {
  cache = null;
  cacheAt = 0;
}

export function publicCatalog() {
  const catalog = loadCatalog();
  const shipping = effectiveShipping(catalog);
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
      inStock: product.inStock !== false,
      // Relative photo paths keyed by colour name. The page paints its build-
      // time photos, but those are the ones the sync last wrote — and when a
      // sync has not run, the DB map is empty and the page falls back to
      // whatever sits in store/catalog.json. Sending the live map lets the
      // runtime correct a stale page without a rebuild, and lets the API and
      // the page agree on which photo belongs to which colour.
      images: product.images || {},
      backImages: product.backImages || {},
    })),
    colors: catalog.colors,
    featuredId: catalog.featuredId,
    upsellId: catalog.upsellId,
    // The season switch. Named `on` rather than a season name so switching to
    // a different season is a value change, not a rewrite of the frontend.
    decoration: {
      on: Boolean(catalog.decoration && catalog.decoration.on),
      name: (catalog.decoration && catalog.decoration.decoration) || 'christmas',
      text: (catalog.decoration && catalog.decoration.text) || '',
    },
    shipping,
    currency: 'USD',
    checkoutLive: isCheckoutLive(),
  };
}

export function publicShipping() {
  return effectiveShipping(loadCatalog());
}

/**
 * Checkout needs a Stripe secret key. Without it the store still browses,
 * adds to bag and shows live prices — it just refuses to take money.
 */
export function isCheckoutLive() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function maxFor(product, color) {
  const cap = Number(product && product.maxPerOrder) || DEFAULT_MAX_PER_LINE;
  if (color && String(color).toLowerCase() === 'sky') return Math.min(FOUNDERS_MAX_PER_LINE, cap);
  return cap;
}

/** Shipping rules, with the database row winning over the env defaults. */
function effectiveShipping(catalog) {
  const s = (catalog && catalog.shipping) || SHIPPING;
  return {
    countries: s.countries || SHIPPING.countries,
    standardShippingCents: s.standardCents ?? SHIPPING.standardCents,
    freeShippingThresholdCents: s.freeOverCents ?? SHIPPING.freeOverCents,
    estimate: s.estimate || SHIPPING.estimate,
    taxNote: s.taxNote || SHIPPING.taxNote,
    currency: s.currency || SHIPPING.currency,
  };
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
        // The colour the shopper picked is already the stored key, and since
        // colours are named exactly as Printful names them (see
        // lib/store/colour-names.js) it is also the right label and the
        // right order-line value. Falling back to the raw key keeps an
        // unknown colour visible instead of rendering "undefined".
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
  const rules = effectiveShipping(catalog);
  const freeShipping = discountedSubtotal >= rules.freeShippingThresholdCents || discount.freeShipping;
  const shippingCents = lines.length === 0 || freeShipping ? 0 : rules.standardShippingCents;

  return {
    lines,
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalCents,
    discountCents: discount.amountCents,
    shippingCents,
    totalCents: Math.max(0, discountedSubtotal + shippingCents),
    freeShippingThresholdCents: rules.freeShippingThresholdCents,
    shipping: {
      amountCents: shippingCents,
      free: shippingCents === 0,
      label: freeShipping ? 'Free standard shipping' : 'Standard shipping',
      estimate: rules.estimate,
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
export function productImageUrls(product, origin, colorKey) {
  const base = process.env.SITE_URL || origin || 'https://www.armoniaconnect.com';
  // Prefer the colour the customer actually chose: Stripe shows this image next
  // to the amount, and a picture of the wrong colour reads as a wrong order.
  const wanted = colorKey && (product.colors || []).includes(colorKey) ? colorKey : (product.colors || [])[0];
  const color = wanted;
  const stored = product.images && product.images[color];

  // A synced mockup is an absolute URL on Printful's CDN. Stripe requires
  // https and will reject a relative one, so pass it through untouched — the
  // old code ran every value through the local-image rewriter, which turned
  // "https://files.cdn.printful.com/files/abc/preview.png" into
  // "<site>/store/images/preview.png": a 404. That is why synced mockups never
  // appeared even once they stopped being dropped.
  if (stored && /^https:\/\//i.test(String(stored))) return [String(stored)];

  const slug = slugForColour(color);
  const relative =
    stored ||
    (product.type === 'windbreaker'
      ? `/store/images/windbreaker-front-${slug}.webp`
      : `/store/images/${product.type}-${slug}.webp`);
  if (!relative) return [];
  return [`${base.replace(/\/$/, '')}${relative.startsWith('/store') ? relative : `/store/images/${relative.split('/').pop()}`}`];
}
