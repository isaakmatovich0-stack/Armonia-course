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
    const colourWildcardKey = `${item.productId}|${colour}|*`;
    const looseKey = `${item.productId}|*|*`;
    const syncVariantId = variants[key] || variants[colourWildcardKey] || variants[looseKey];
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
    case 'order_canceled':
      return { fulfilment: 'failed', orderStatus: null, notify: false };
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

/**
 * Every sync product in the store, with its variants flattened.
 *
 * Printful returns product summaries without variants, so this costs one extra
 * request per product. Stores here are small (single digits of products), and
 * the alternative — asking a human to copy dozens of ids out of a dashboard —
 * is how mapping mistakes happen.
 */
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

  return detailed.filter(Boolean).map((entry) => {
    const product = entry.sync_product || {};
    return {
      id: product.id,
      externalId: product.external_id || null,
      name: product.name || '',
      thumbnail: product.thumbnail_url || null,
      variantCount: product.variants,
      variants: (entry.sync_variants || []).map((v) => {
        // Each sync variant carries its own mockup in `files` with type
        // "preview". That is a per-colour product photo, which is exactly what
        // the storefront needs — our catalogue is keyed by colour, not by
        // product. Falling back to the product thumbnail would show the same
        // picture for every colour, which reads as a bug to a shopper.
        const files = Array.isArray(v.files) ? v.files : [];

        // THE MOCKUP IS NOT `url`, AND IT IS NOT type:"preview".
        //
        // On a sync variant, `files[].type` is the PRINT AREA — "default",
        // "back", "label_inside". There is no type "preview", so the old
        // `files.find(f => f.type === 'preview')` matched nothing on every
        // product ever synced, and the code fell through to `f.url`: the raw
        // artwork we uploaded. That single mistake caused both things the owner
        // reported. The artwork is a flat design on its own square field, so
        // every store photo looked "like it is on its own background". And the
        // artwork is byte-identical for every colour of a product, so all
        // colours shared one picture — which is why only one colour ever had a
        // photo and the rest had none.
        //
        // The photograph of the actual garment is minted per sync variant and
        // lives in `preview_url` (falling back to `thumbnail_url`).
        const mockupOf = (file) => (file && (file.preview_url || file.thumbnail_url)) || null;
        const mockups = files.map(mockupOf).filter(Boolean);
        const preview = mockups[0] || null;
        // Distinct only: Printful repeats the same URL once per print file, and
        // handing the caller duplicates would defeat its shared-URL guard.
        const allPreviews = [...new Set(mockups)];
        // Kept separate and deliberately NOT used as a photo. It is the artwork,
        // useful for diagnosing "Printful has no mockup for this product yet".
        const artwork = files.map((f) => f && f.url).filter(Boolean);
        const anyFile = files.find((f) => f && f.url);
        return {
          // The id Printful wants on POST /orders. Not the catalog variant id.
          syncVariantId: v.id,
          variantId: v.variant_id,
          name: v.name || '',
          colour: (v.color || '').trim(),
          size: (v.size || '').trim(),
          price: v.retail_price || null,
          preview,
          previews: allPreviews,
          // Only ever a rendered garment shot — never the print file. `null`
          // here means "create a mockup in Printful", which the admin reports.
          thumbnail: v.thumbnail_url || preview || null,
          artwork: artwork[0] || null,
          hasMockup: Boolean(preview),
        };
      }),
    };
  });
}

/**
 * Generate a garment mockup for one or more variants, in place.
 *
 * WHY THIS EXISTS
 * ---------------
 * A per-colour photo cannot be invented: the shopper has to see the actual
 * garment in the actual colour. Printful mints those photographs per sync
 * variant, but only when a mockup has been generated, and nothing in this app
 * ever generated one — so most colours had no picture and the shop showed a
 * placeholder while one colour borrowed another's photo.
 *
 * This is the Mockup Generator API: POST a task referencing the variant's print
 * file, then read it back for the produced image URLs. The task id is per
 * request, so the caller batches rather than calling once per colour.
 *
 * ⚠ NOT EXERCISED IN THIS SESSION — the dev sandbox cannot reach
 * api.printful.com (`SSL_ERROR_SYSCALL`), so this path has never run against
 * the live account. It is written to the documented contract and fails loudly
 * rather than silently returning nothing. Nothing here places an order or
 * charges anything; the worst case is a wasted call and an error in the admin.
 *
 * @param variantIds  Printful catalog variant ids to render (one per colour)
 * @param files       print files to place, [{ type, url }]
 * @param options     { format: 'png', width, height, productId }
 * @returns { taskKey, mockups: { [variantId]: url } }
 */
export async function createMockupTask(variantIds, files, options = {}) {
  const ids = (variantIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) throw new Error('No Printful variant ids to render.');
  const printFiles = (files || []).filter((f) => f && f.url);
  if (!printFiles.length) throw new Error('No print file to render — the variant has no artwork.');

  const body = {
    // One variant entry per colour; Printful keys the response by variant id.
    variant_ids: ids,
    format: options.format || 'png',
    files: printFiles.map((f) => ({ placement: f.type || 'default', url: f.url })),
  };
  if (options.width && options.height) body.width = options.width, body.height = options.height;
  if (options.productId) body.product_id = Number(options.productId);

  const created = await call('/mockup-generator/create-task', { method: 'POST', body });
  const taskKey = created && created.result && created.result.task_key;
  if (!taskKey) throw new Error('Printful did not return a mockup task key.');

  // The task is asynchronous. Poll a bounded number of times: a stuck task must
  // surface as an error the owner can act on, not as a request that hangs until
  // the platform times the function out.
  const deadline = Date.now() + 45_000;
  let lastStatus = 'pending';
  while (Date.now() < deadline) {
    const task = await call(`/mockup-generator/task?task_key=${encodeURIComponent(taskKey)}`);
    const result = (task && task.result) || {};
    lastStatus = result.status || lastStatus;
    if (lastStatus === 'completed') {
      const mockups = {};
      for (const entry of result.mockups || []) {
        // Printful returns one mockup per variant id; keep the first per colour.
        const id = String(entry.variant_id ?? entry.variant_ids?.[0] ?? '');
        const url = entry.mockup_url || (Array.isArray(entry.extra_mockup_urls) ? entry.extra_mockup_urls[0] : null);
        if (id && url && !mockups[id]) mockups[id] = url;
      }
      return { taskKey, mockups };
    }
    if (lastStatus === 'failed') throw new Error('Printful could not generate that mockup.');
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error(`Printful's mockup task did not finish in time (last status: ${lastStatus}).`);
}

/**
 * Rendered garment photos for every variant of every product in the store.
 *
 * Read-only and cheap to reason about: it returns `{ productId: { colour: url } }`
 * for the colours Printful already has mockups for, and lists the ones it does
 * not, so the admin can say exactly which colours still need one.
 */
export async function listVariantMockups() {
  const products = await listSyncProducts();
  const have = {};
  const missing = [];
  for (const product of products) {
    const pid = product.externalId || product.id;
    have[pid] = {};
    for (const variant of product.variants || []) {
      const colour = String(variant.colour || '').trim();
      if (!colour) continue;
      const shot = variant.preview || variant.thumbnail || null;
      if (shot && !have[pid][colour]) have[pid][colour] = shot;
      else if (!shot) missing.push({ productId: pid, colour, variantId: variant.variantId, syncVariantId: variant.syncVariantId });
    }
  }
  return { have, missing };
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
  const base = String(baseUrl || process.env.SITE_URL || 'https://armoniaconnect.com').replace(/\/+$/, '');
  return `${base}/api/store/supplier-webhook?token=${encodeURIComponent(token)}`;
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
