// Supplier fulfilment — Printful.
//
// The store's job ends at "money arrived". Everything after that is this
// module's: turn our order into a Printful order, release it, and take the
// tracking number back when Printful ships.
//
// Design notes
// ------------
// • No key, no calls. `isConfigured()` is checked before anything leaves the
//   process, so a deploy without PRINTFUL_API_TOKEN behaves exactly as it did
//   before this file existed: orders sit in the admin as `paid` and nothing
//   fails. That also means this code is safe to ship before the supplier
//   account exists.
//
// • Idempotent by external_id. Printful rejects a second order with the same
//   external_id, and we store the supplier order id on our row first, so a
//   retried Stripe webhook cannot print an order twice.
//
// • `draft` mode exists because the first real order should be a rehearsal.
//   PRINTFUL_DRAFT=1 creates the order without charging or printing it.
//
// • A supplier failure never loses an order. It is recorded on the row as
//   fulfilment_error + fulfilment_status='failed', which the admin shows at the
//   top of Store Orders. Silently swallowing it would mean a paid customer
//   whose parcel was never made.

import { stablePhoto } from '../store/mockup-photos.js';
import { resolveSupplierVariant } from '../store/supplier-variants.js';

const API = process.env.PRINTFUL_API_BASE || 'https://api.printful.com';
const TIMEOUT_MS = 20_000;

const token = () => process.env.PRINTFUL_API_TOKEN || '';
const draftMode = () => process.env.PRINTFUL_DRAFT === '1';

export function isConfigured() {
  return Boolean(token());
}

// ── Which store? ───────────────────────────────────────────────────────
//
// Printful scopes almost every useful endpoint to a store, and answers
// "This endpoint requires store_id!" when it cannot work out which one — which
// happens with zero stores, or several and none pinned.
//
// PRINTFUL_STORE_ID overrides everything. Without it we ask Printful which
// stores the token can see and use the only one. That is the normal case, and it
// removes a manual lookup that has no answer before the store exists: the ID is
// assigned at creation, so "where do I find it" is unanswerable until then.
let storeIdCache = { value: null, at: 0 };
const STORE_TTL_MS = 60_000;

async function resolveStoreId() {
  const pinned = process.env.PRINTFUL_STORE_ID;
  if (pinned) return String(pinned);
  if (storeIdCache.value && Date.now() - storeIdCache.at < STORE_TTL_MS) return storeIdCache.value;

  const res = await rawFetch('/stores');
  const stores = (res && res.result) || [];
  if (!stores.length) {
    const err = new Error(
      'Your Printful account has no store yet. Create one at Printful → Stores → Add store → "Manual order platform / API" → Connect via API. Products and orders both live inside a store, so nothing can be read or created until it exists.'
    );
    err.code = 'NO_STORE';
    throw err;
  }
  if (stores.length > 1) {
    const err = new Error(
      `Your Printful account has ${stores.length} stores, so PRINTFUL_STORE_ID must be set in Vercel to one of: ` +
      stores.map((s) => `${s.name} (${s.id})`).join(', ')
    );
    err.code = 'MANY_STORES';
    throw err;
  }
  storeIdCache = { value: String(stores[0].id), at: Date.now() };
  return storeIdCache.value;
}

/** One HTTP round trip. No store resolution, no retry — the primitive below. */
async function rawFetch(path, { method = 'GET', body, storeId } = {}) {
  const headers = { authorization: `Bearer ${token()}` };
  if (body) headers['content-type'] = 'application/json';
  if (storeId) headers['X-PF-Store-Id'] = String(storeId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
    if (!res.ok) {
      const detail = (json && (json.error?.message || json.error || json.message)) || text.slice(0, 300);
      const err = new Error(`Printful ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
      err.status = res.status;
      throw err;
    }
    return json;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Printful did not respond in time.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function call(path, { method = 'GET', body, storeId, requiresStore = true } = {}) {
  if (!isConfigured()) throw new Error('PRINTFUL_API_TOKEN is not set.');
  // /stores is account-level; everything else needs the store pinned.
  const pinned = storeId || (requiresStore ? await resolveStoreId() : null);
  return rawFetch(path, { method, body, storeId: pinned });
}

/**
 * Build a Printful order payload from one of our order rows.
 *
 * `variants` is a map of "productId|color|size" → sync_variant_id, which lives
 * on store_products.supplier_variants (editable from the admin). A line without
 * a mapping is reported rather than guessed: shipping the wrong garment is
 * worse than not shipping it.
 */
export function buildOrderPayload(order, variants) {
  const address = order.shipping_address || {};
  const recipient = {
    name: order.name || address.name || '',
    email: order.email || '',
    address1: address.line1 || '',
    address2: address.line2 || '',
    city: address.city || '',
    state_code: address.state || '',
    country_code: address.country || 'US',
    zip: address.postal_code || '',
  };
  if (order.phone) recipient.phone = order.phone;

  const missing = [];
  const items = [];
  for (const item of order.items || []) {
    // The colour on an order line is `colorName` (what fulfilment.js builds
    // keys from); `color`/`colorKey` are the legacy spellings. Trying all three
    // is defence in depth: colour names are Printful's now, so the first lookup
    // is the one that matters, and the others stop an older stored order from
    // silently failing to ship.
    const colour = item.color || item.colorName || item.colorKey || '';
    const key = `${item.productId}|${colour}|${item.size || ''}`;
    // Two wildcards, and both are needed. A one-size product is keyed on the
    // colour with `*` for size, because Printful returns no size for caps,
    // beanies and stickers — but the order line still carries "ONE SIZE". Without
    // the colour wildcard that line looked unmapped, so a fully-mapped product
    // reported `missing` and Printful was never asked to ship it.
    const syncVariantId = resolveSupplierVariant(variants, item.productId, colour, item.size || '');
    if (!syncVariantId) {
      missing.push(key);
      continue;
    }
    items.push({
      sync_variant_id: Number(syncVariantId),
      quantity: Number(item.quantity) || 1,
      // Printful needs a retail price for customs paperwork on international
      // parcels; it does not change what the customer was charged.
      retail_price: item.unitPriceCents != null ? (item.unitPriceCents / 100).toFixed(2) : undefined,
    });
  }

  return {
    payload: {
      external_id: order.number,
      ...(draftMode() ? { draft: true } : {}),
      recipient,
      shipping: 'STANDARD',
      items,
    },
    missing,
    empty: items.length === 0,
  };
}

/**
 * Create + confirm a Printful order.
 * Returns { id, status } — never throws for "not configured", only for real
 * transport/API failures, which the caller records on the order row.
 */
export async function submitOrder(order, variants) {
  const { payload, missing, empty } = buildOrderPayload(order, variants);

  if (empty) {
    return { skipped: true, reason: 'No line on this order has a supplier variant mapped yet.', missing };
  }
  if (missing.length) {
    // Partial fulfilment is worse than none: the customer would get half an
    // order and wonder where the rest is. Flag it instead.
    return { skipped: true, reason: `Missing supplier mapping for: ${missing.join(', ')}`, missing };
  }

  let created;
  try {
    created = await call('/orders', { method: 'POST', body: payload });
  } catch (err) {
    // Printful keys orders by external_id and refuses duplicates. That normally
    // means our row lost its supplier_order_id (a restore, a manual delete, a
    // race between two webhooks) and the parcel may already be in production.
    // Adopt the existing order rather than leaving the customer in limbo.
    if (/already exists/i.test(err.message)) {
      const existing = await findByExternalId(payload.external_id);
      if (existing) return { id: existing.id, status: existing.status || 'submitted', confirmed: true, adopted: true };
    }
    throw err;
  }

  const supplierOrderId = created?.result?.id;
  if (!supplierOrderId) throw new Error('Printful accepted the order but returned no id.');

  // A draft is deliberately left unreleased.
  if (draftMode()) {
    return { id: supplierOrderId, status: 'draft', confirmed: false };
  }

  await call(`/orders/${supplierOrderId}/confirm`, { method: 'POST' });
  return { id: supplierOrderId, status: 'submitted', confirmed: true };
}

/**
 * Find an existing Printful order by our order number.
 * There is no direct lookup by external_id, so this pages the recent order
 * list. Only ever called on the duplicate path.
 */
async function findByExternalId(externalId) {
  if (!externalId) return null;
  try {
    const res = await call('/orders?limit=100');
    const list = (res && res.result) || [];
    const match = list.find((o) => String(o.external_id) === String(externalId));
    return match ? { id: match.id, status: match.status } : null;
  } catch {
    return null;
  }
}

/** Cancel/reject an order at the supplier — used when a refund happens. */
export async function cancelOrder(supplierOrderId) {
  return call(`/orders/${supplierOrderId}`, { method: 'DELETE' });
}

/** Cheap credential check for the admin's "Test connection" button. */
export async function health() {
  if (!isConfigured()) return { configured: false };
  try {
    // /stores is account-level, so it must not go through store resolution —
    // that would ask /stores in order to call /stores.
    const res = await call('/stores', { requiresStore: false });
    const stores = (res && res.result) || [];
    return {
      configured: true,
      ok: true,
      // `id` matters: it is what PRINTFUL_STORE_ID must be set to when the
      // account has more than one store, and Printful's /stores payload does
      // not always include it. Without it the admin can name the stores but not
      // tell you which number to paste.
      stores: stores.map((s) => ({ id: s.id, name: s.name, type: s.type, platform: s.platform || null })),
      // Surfaced so the admin can say "you have no store yet" instead of
      // letting the user hit a 400 from a deeper endpoint.
      storeCount: stores.length,
      storeId: stores.length === 1 ? String(stores[0].id) : (process.env.PRINTFUL_STORE_ID || null),
    };
  } catch (err) {
    return { configured: true, ok: false, error: err.message };
  }
}

/**
 * Map a `package_shipped` webhook onto our order row.
 * Printful's payload puts tracking at data.shipment, and our order number at
 * data.order.external_id — the id we sent when creating the order.
 */
export function shipmentFromWebhook(body) {
  const data = (body && body.data) || {};
  const shipment = data.shipment || {};
  const order = data.order || {};
  return {
    externalId: order.external_id || null,
    supplierOrderId: order.id || data.order_id || null,
    carrier: shipment.carrier || null,
    service: shipment.service || null,
    trackingNumber: shipment.tracking_number || null,
    trackingUrl: shipment.tracking_url || null,
    shippedAt: shipment.ship_date ? new Date(shipment.ship_date).toISOString() : new Date().toISOString(),
  };
}

/** Which Printful events we act on, and what they mean for our order status. */
export function eventEffect(type) {
  switch (type) {
    case 'package_shipped':
      return { fulfilment: 'shipped', orderStatus: 'shipped', notify: true };
    case 'order_failed':
      return { fulfilment: 'failed', orderStatus: null, notify: false };
    case 'order_canceled':
      return { fulfilment: 'canceled', orderStatus: null, notify: false };
    case 'package_returned':
      return { fulfilment: 'returned', orderStatus: null, notify: false };
    default:
      return null;
  }
}

// ── Reading the store back ─────────────────────────────────────────────
//
// Creating a product in Printful's dashboard mints a `sync_variant_id` for every
// colour/size. Our fulfilment code needs those ids, and they are opaque — they
// cannot be derived from the catalog `variant_id`, and guessing them is the one
// mistake that would send a customer the wrong garment. So we read them.

/** Use the same Printful sync variant IDs as the eventual fulfilment order. */
export function buildShippingEstimateItems(lines, catalog) {
  return lines.map(line => {
    const product = catalog.byId.get(line.productId);
    if (!product || (product.supplier && product.supplier !== 'printful')) throw new Error('Shipping is not available for this supplier.');
    const colour = line.colorName || line.color;
    const syncId = Number(resolveSupplierVariant(product.supplierVariants || {}, line.productId, colour, line.size));
    if (!Number.isSafeInteger(syncId) || syncId <= 0) throw new Error(`No Printful shipping variant for ${line.productId}.`);
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error('Invalid quantity for shipping quote.');
    return {
      sync_variant_id: syncId,
      quantity: line.quantity,
      ...(line.unitPriceCents != null ? { retail_price: (line.unitPriceCents / 100).toFixed(2) } : {}),
    };
  });
}

/** Estimate shipping for the actual configured sync variants and destination. */
export async function quoteShipping(recipient, lines, catalog) {
  if (!lines?.length) throw new Error('Cannot quote an empty bag.');
  if (recipient?.country_code !== 'US' || !recipient.state_code || !recipient.zip) throw new Error('A US state and ZIP code are required for a shipping quote.');
  const items = buildShippingEstimateItems(lines, catalog);
  const response = await call('/orders/estimate-costs', { method: 'POST', body: { recipient, shipping: 'STANDARD', items } });
  const costs = response?.result?.costs;
  const amount = String(costs?.shipping ?? '');
  if (String(costs?.currency || '').toUpperCase() !== 'USD' || !/^\d+(?:\.\d{1,2})?$/.test(amount)) throw new Error('No standard Printful shipping estimate is available.');
  const cents = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Invalid Printful shipping rate.');
  return { id: 'STANDARD', name: 'Standard', amountCents: cents };
}

export async function listSyncProducts() {
  if (!isConfigured()) throw new Error('PRINTFUL_API_TOKEN is not set.');

  const listRes = await call('/store/products');
  const summaries = (listRes && listRes.result) || [];

  const detailed = await Promise.all(
    summaries.map(async (summary) => {
      try {
        const detail = await call(`/store/products/${summary.id}`);
        return (detail && detail.result) || null;
      } catch {
        // One unreadable product must not blank the whole list; the caller sees
        // it as missing variants rather than as an empty store.
        return { sync_product: summary, sync_variants: [] };
      }
    })
  );

  // Older store-product responses omit colour and size. The catalog endpoint
  // provides those fields keyed by the same catalog variant id; do not guess
  // from a product name. Only fetch catalog products when fields are missing.
  const catalogIds = [...new Set(detailed.flatMap((entry) => (entry?.sync_variants || [])
    .filter((v) => (!v.color || !v.size) && v.product?.product_id)
    .map((v) => v.product.product_id)))];
  const catalogVariants = new Map();
  await Promise.all(catalogIds.map(async (id) => {
    try {
      const response = await call(`/products/${encodeURIComponent(id)}`, { requiresStore: false });
      for (const variant of response?.result?.variants || []) catalogVariants.set(String(variant.id), variant);
    } catch {
      // Missing catalog metadata leaves that variant unmapped, not guessed.
    }
  }));

  return detailed.filter(Boolean).map((entry) => {
    const product = entry.sync_product || {};
    return {
      id: product.id,
      externalId: product.external_id || null,
      name: product.name || '',
      thumbnail: product.thumbnail_url || null,
      variantCount: product.variants,
      variants: (entry.sync_variants || []).map((v) => {
        // Only a file explicitly marked as a mockup/preview is a candidate
        // garment image. Preview URLs on ordinary print files are previews of
        // the artwork, not proof of a photo of the finished product.
        const files = Array.isArray(v.files) ? v.files : [];
        // Store sync's images map is the *front* gallery. Printful may attach
        // a back mockup as the variant's only preview (e.g. the classic tee).
        // Never import an explicitly back-labelled image into the front slot.
        const previewFiles = files.filter((f) => f && f.type === 'preview' && !/(?:^|[-_\s])back(?:[-_\s.]|$)/i.test(f.filename || ''));
        const mockups = previewFiles.map((f) => [f.preview_url, f.thumbnail_url, f.url].find(stablePhoto)).filter(Boolean);
        const preview = mockups[0] || null;
        const allPreviews = [...new Set(mockups)];
        const artwork = files.filter((f) => f && f.type !== 'preview').map((f) => f.url).filter(Boolean);
        const catalogVariant = catalogVariants.get(String(v.variant_id)) || {};
        return {
          // The id Printful wants on POST /orders. Not the catalog variant id.
          syncVariantId: v.id,
          variantId: v.variant_id,
          catalogProductId: v.product?.product_id || null,
          name: v.name || '',
          colour: String(v.color || catalogVariant.color || '').trim(),
          size: String(v.size || catalogVariant.size || '').trim(),
          price: v.retail_price || null,
          preview,
          previews: allPreviews,
          // Only ever a rendered garment shot — never the print file. `null`
          // here means "create a mockup in Printful", which the admin reports.
          thumbnail: preview,
          artwork: artwork[0] || null,
          hasMockup: Boolean(preview),
        };
      }),
    };
  });
}

/**
 * Suggests a `product|colour|size` key for each Printful variant.
 *
 * THE BUG THIS REPLACES
 * ---------------------
 * This used to key on OUR colour names ("ink", "ivory", "sky", "orange") and
 * prefill a colour only when Printful's distinct-colour count happened to equal
 * ours. Two consequences, both fatal:
 *
 *   1. A tee has ~12 Printful colours to our 3, so `confident` was never true,
 *      every colour field came back blank, and the save was refused with
 *      "pick a colour for each" — on every product, forever.
 *   2. Even a successful save wrote `hat|black|ONE SIZE`, while a real order
 *      carries `hat|Black|ONE SIZE` (the colour *name*). Nothing matched.
 *
 * The colours are now Printful's own names on both sides (see
 * lib/store/colour-names.js), so they match by construction and there is
 * nothing to prefill by hand: a variant's colour IS the key.
 *
 * `size` defaults to `*` for a one-size product, and the whole map can be
 * written in one shot with `productId|*|*` for solid-colour garments where
 * every variant carries the same artwork.
 */
export function suggestMapping(printfulProducts, ourProducts) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const matchProduct = (pf, ours) => {
    if (pf.externalId && pf.externalId === ours.id) return 2;         // explicit, trust it
    const a = norm(pf.name), b = norm(ours.name);
    if (!a || !b) return 0;
    if (a === b) return 2;
    if (a.includes(b) || b.includes(a)) return 1;                     // partial, likely
    return 0;
  };

  const suggestions = [];
  const taken = new Set();

  for (const pf of printfulProducts) {
    let best = null, bestScore = 0;
    for (const ours of ourProducts) {
      if (taken.has(ours.id)) continue;
      const score = matchProduct(pf, ours);
      if (score > bestScore) { best = ours; bestScore = score; }
    }
    if (!best) {
      suggestions.push({
        productId: null, printfulProduct: pf.name, key: null,
        note: `No product in our catalogue matches "${pf.name}". Map it by hand.`,
        variants: pf.variants.map((v) => ({
          syncVariantId: String(v.syncVariantId), variantName: v.name,
          colour: v.colour, size: v.size, key: null,
        })),
      });
      continue;
    }
    taken.add(best.id);

    const ourColours = Array.isArray(best.colors) ? best.colors : [];
    const sizes = Array.isArray(best.sizes) ? best.sizes : [];
    const oneSize = sizes.length <= 1;

    suggestions.push({
      productId: best.id,
      ourProduct: best.name,
      printfulProduct: pf.name,
      confidence: bestScore === 2 ? 'high' : 'likely',
      variants: pf.variants.map((v) => {
        // Printful's name, verbatim. No translation, so the key an order builds
        // from `colorName` is byte-identical to the key written here.
        const colour = String(v.colour || '').trim();
        const size = oneSize
          ? (sizes[0] || '*')
          : (String(v.size || '').trim() || '*');
        return {
          syncVariantId: String(v.syncVariantId),
          variantName: v.name,
          printfulColour: colour || '*',
          colour,
          size,
          key: colour ? `${best.id}|${colour}|${size}` : null,
          // A colour Printful reports that our product does not sell would put
          // an unbuyable variant in the map. Flag it, do not hide it.
          colourNotSold: Boolean(colour) && ourColours.length > 0 && !ourColours.includes(colour),
        };
      }),
      // Every colour mapped in one row. For a solid-colour garment all variants
      // print the same artwork, so one wildcard is the honest representation
      // and avoids a 96-row table nobody will proofread.
      wildcard: { key: `${best.id}|*|*`, note: 'one row that covers every colour and size' },
      coloursToPlace: ourColours,
    });
  }
  return suggestions;
}


// ── Webhooks ───────────────────────────────────────────────────────────
//
// Printful has NO dashboard screen for webhooks. They exist only as an API
// setting (POST /webhooks), which is why "go to Settings → Webhooks" is advice
// that cannot be followed. Registering one means calling this from the server.
//
// Two consequences worth knowing before the call:
//   • Only ONE webhook config can exist per store/token. POSTing replaces any
//     existing one, including one somebody set up by hand.
//   • The token is part of the URL, so the URL is a secret. It is logged by
//     Printful and stored in their UI — treat PRINTFUL_WEBHOOK_TOKEN as disposable.

export const WEBHOOK_EVENTS = ['package_shipped', 'order_failed', 'order_canceled', 'package_returned'];

/** The URL Printful should call, including our shared token. */
export function webhookUrl(baseUrl) {
  const token = process.env.PRINTFUL_WEBHOOK_TOKEN || '';
  if (!token) return null;
  const base = new URL(String(baseUrl || process.env.SITE_URL || 'https://www.armoniaconnect.com'));
  // The apex redirects POSTs. Use the final host so Printful can deliver events directly.
  if (base.hostname === 'armoniaconnect.com') base.hostname = 'www.armoniaconnect.com';
  return `${base.toString().replace(/\/+$/, '')}/api/store/supplier-webhook?token=${encodeURIComponent(token)}`;
}

/** What Printful currently has configured, if anything. */
export async function getWebhook() {
  if (!isConfigured()) throw new Error('PRINTFUL_API_TOKEN is not set.');
  try {
    const res = await call('/webhooks');
    return { configured: true, ...((res && res.result) || {}) };
  } catch (err) {
    // A 404 here means "no webhook set up", not "the call failed". Printful
    // reports that as an error, so it is translated rather than thrown.
    if (/not found|404/i.test(err.message)) return { configured: false };
    throw err;
  }
}

/**
 * Point Printful at us. Replaces whatever was there — Printful allows one.
 */
export async function setWebhook(url, types = WEBHOOK_EVENTS) {
  if (!isConfigured()) throw new Error('PRINTFUL_API_TOKEN is not set.');
  if (!url) throw new Error('PRINTFUL_WEBHOOK_TOKEN is not set, so there is no URL to register.');
  const res = await call('/webhooks', { method: 'POST', body: { url, types } });
  return (res && res.result) || { url, types };
}

/**
 * Create a sync product in the store. The body is exactly what the caller built
 * in lib/store/create-products.js — this only adds the store pin and POSTs.
 */
export async function createSyncProduct(body) {
  return call('/store/products', { method: 'POST', body });
}

// Template-backed mockups: the saved template supplies all original artwork
// and placement information. Task results are temporary, never store their
// URLs directly. These operations do not create or modify products or orders.
export async function listProductTemplates() {
  const items = [];
  let offset = 0;
  while (true) {
    const response = await call(`/product-templates?limit=100&offset=${offset}`, { requiresStore: false });
    const page = response?.result?.items;
    if (!Array.isArray(page)) throw new Error('Printful returned an invalid template list.');
    items.push(...page);
    offset += page.length;
    if (!page.length || offset >= (response.paging?.total ?? offset)) break;
    if (offset >= 2000) throw new Error('Printful returned too many templates to list safely.');
  }
  return items;
}

export async function startTemplateMockup(catalogProductId, templateId, variantIds) {
  const product = Number(catalogProductId), template = Number(templateId);
  const ids = [...new Set((variantIds || []).map(Number))];
  if (!Number.isSafeInteger(product) || product <= 0 || !Number.isSafeInteger(template) || template <= 0 || !ids.length || ids.some((n) => !Number.isSafeInteger(n) || n <= 0)) throw new Error('Invalid template, product, or variant id.');
  const response = await call(`/mockup-generator/create-task/${product}`, {
    method: 'POST', body: { product_template_id: template, variant_ids: ids, format: 'png' },
  });
  const task = response?.result?.task_key;
  if (typeof task !== 'string' || !task) throw new Error('Printful did not return a task key.');
  return task;
}

export async function getTemplateMockup(taskKey) {
  if (typeof taskKey !== 'string' || !taskKey || taskKey.length > 200) throw new Error('Invalid task key.');
  const response = await call(`/mockup-generator/task?task_key=${encodeURIComponent(taskKey)}`);
  const task = response?.result;
  if (!task || typeof task.status !== 'string') throw new Error('Printful returned an invalid task result.');
  return task;
}
