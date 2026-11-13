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

async function call(path, { method = 'GET', body, storeId } = {}) {
  if (!isConfigured()) throw new Error('PRINTFUL_API_TOKEN is not set.');

  const headers = { authorization: `Bearer ${token()}` };
  if (body) headers['content-type'] = 'application/json';
  // Printful accounts with several stores need the store pinned per request.
  if (storeId || process.env.PRINTFUL_STORE_ID) headers['X-PF-Store-Id'] = String(storeId || process.env.PRINTFUL_STORE_ID);

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
    const key = `${item.productId}|${item.color || item.colorKey || ''}|${item.size || ''}`;
    const looseKey = `${item.productId}|*|*`;
    const syncVariantId = variants[key] || variants[looseKey];
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
    const res = await call('/stores');
    const stores = (res && res.result) || [];
    return { configured: true, ok: true, stores: stores.map((s) => ({ id: s.id, name: s.name, type: s.type })) };
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
