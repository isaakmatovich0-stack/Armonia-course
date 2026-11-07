// Supplier fulfilment — PrintKK (the pick set).
//
// Printful does not carry guitar picks, so the pick set is fulfilled by
// PrintKK instead. Three of their documented behaviours shape this file, and
// all three are load-bearing:
//
//  1. Requests are signed, not bearer-authenticated. Every call needs
//     `api-key` in the header plus `timestamp`, optionally `recvWindow`, and an
//     HMAC-SHA256 `signature` over "METHOD\n/path\nsorted-params". Missing this
//     is a 401 with no useful message, so signing is done in one place.
//
//  2. There are NO webhooks. PrintKK's FAQ is explicit: "There is no official
//     Webhook endpoint or callback mechanism… developers need to actively
//     obtain the latest status by polling." So tracking arrives by asking
//     /api/v1/order/shipments on a schedule, not by being pushed to.
//     `refreshShipments()` is that poll.
//
//  3. Orders are placed and then paid from a prepaid PrintKK wallet. Creating
//     an order costs nothing; paying it spends real money and cannot be undone.
//     We therefore create and stop at 'awaiting payment' by default, and only
//     pay when PRINTKK_AUTO_PAY=1. A wallet with a stale balance silently
//     failing is a far better outcome than a double-pay.
//
// ⚠ The create-order and pay-order request bodies are the least certain thing
// in this integration: PrintKK publishes them behind a JS-rendered reference
// that cannot be read reliably by a script, so the field names below are
// modelled on their documented flow (design → variant → order) and MUST be
// confirmed against the live API with a sandbox order before the pick set goes
// on sale. Everything else here — signing, error handling, polling, idempotency
// — is exercised by tests.

import crypto from 'node:crypto';

const API = process.env.PRINTKK_API_BASE || 'https://api.printkk.com';
const TIMEOUT_MS = 20_000;
const RECV_WINDOW = 5000;

const apiKey = () => process.env.PRINTKK_API_KEY || '';
const secretKey = () => process.env.PRINTKK_SECRET_KEY || '';
const autoPay = () => process.env.PRINTKK_AUTO_PAY === '1';

export function isConfigured() {
  return Boolean(apiKey() && secretKey());
}

/* ── signing ───────────────────────────────────────────────────────────── */

/**
 * Serialise one parameter the way PrintKK's verifier does.
 * Arrays become Java lists ([a, b]); objects become Java maps
 * ({k=v, k2=v2}) with insertion order preserved. Booleans are lowercase.
 * The exact brackets and spaces are part of the signature.
 */
function serializeValue(value) {
  if (Array.isArray(value)) return `[${value.map(serializeValue).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, inner]) => inner !== undefined)
      .map(([key, inner]) => `${key}=${serializeValue(inner)}`)
      .join(', ')}}`;
  }
  if (typeof value === 'boolean') return String(value);
  return String(value);
}

/** Sorted, filtered parameter string used in the signature and the request. */
export function normalizeParams(params) {
  const entries = Object.entries(params || {})
    .filter(([key, value]) => key !== 'signature' && key !== 'file')
    .filter(([, value]) => value !== null && value !== undefined && value !== '' && value !== 'null');
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries;
}

/** HMAC-SHA256 over "METHOD\n/path\nsorted=params". */
export function sign(method, path, params, secret = secretKey()) {
  const normalized = normalizeParams(params)
    .map(([key, value]) => `${key}=${serializeValue(value)}`)
    .join('&');
  const signString = `${method.toUpperCase()}\n${path}\n${normalized}`;
  return crypto.createHmac('sha256', secret).update(signString, 'utf8').digest('hex');
}

/* ── transport ─────────────────────────────────────────────────────────── */

/**
 * One signed request. GET carries its parameters in the query string, every
 * other verb carries them in the JSON body — including timestamp and
 * signature, which PrintKK requires in both cases.
 */
async function call(method, path, params = {}) {
  if (!isConfigured()) throw new Error('PRINTKK_API_KEY / PRINTKK_SECRET_KEY are not set.');

  const payload = {
    ...params,
    timestamp: Date.now(),
    recvWindow: Number(process.env.PRINTKK_RECV_WINDOW || RECV_WINDOW),
  };
  const signature = sign(method, path, payload);
  const headers = { 'api-key': apiKey() };

  let url = `${API}${path}`;
  let body;
  if (method === 'GET') {
    const query = new URLSearchParams();
    for (const [key, value] of normalizeParams(payload)) {
      query.set(key, typeof value === 'object' ? serializeValue(value) : String(value));
    }
    query.set('signature', signature);
    url += `?${query.toString()}`;
  } else {
    headers['content-type'] = 'application/json';
    body = JSON.stringify({ ...payload, signature });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }

    // PrintKK can return HTTP 200 with success:false, so both are checked.
    if (!res.ok || !json || json.success === false || (json.code !== undefined && Number(json.code) !== 200)) {
      const msg = (json && json.msg) || text.slice(0, 240) || `HTTP ${res.status}`;
      const err = new Error(`PrintKK ${json?.code || res.status}: ${msg}`);
      err.status = res.status;
      err.code = json?.code;
      throw err;
    }
    return json.data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('PrintKK did not respond in time.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ── operations ────────────────────────────────────────────────────────── */

export async function health() {
  if (!isConfigured()) return { configured: false };
  try {
    await call('GET', '/api/v1/general/ping', {});
    return { configured: true, ok: true };
  } catch (err) {
    return { configured: true, ok: false, error: err.message };
  }
}

/**
 * Create an unpaid order for one of our orders.
 *
 * `items` on our order row already carry the PrintKK variant reference in
 * supplier_variants (product|color|size → designVariantId). We send one line
 * per item and stop before payment unless PRINTKK_AUTO_PAY=1.
 */
export async function submitOrder(order, variants) {
  const address = order.shipping_address || {};
  const missing = [];
  const lines = [];

  for (const item of order.items || []) {
    const exact = `${item.productId}|${item.color || item.colorKey || ''}|${item.size || ''}`;
    const variantId = variants[exact] || variants[`${item.productId}|*|*`];
    if (!variantId) { missing.push(exact); continue; }
    lines.push({ designVariantId: variantId, quantity: Number(item.quantity) || 1 });
  }

  if (!lines.length) {
    return { skipped: true, reason: 'No line on this order has a PrintKK variant mapped yet.', missing };
  }
  if (missing.length) {
    return { skipped: true, reason: `Missing PrintKK mapping for: ${missing.join(', ')}`, missing };
  }

  const created = await call('POST', '/api/v1/order', {
    // Our own number, so a poll or a support email can be matched back.
    referenceId: order.number,
    items: lines,
    shippingAddress: {
      name: order.name || address.name || '',
      phone: order.phone || address.phone || '',
      countryCode: address.country || 'US',
      province: address.state || '',
      city: address.city || '',
      address1: address.line1 || '',
      address2: address.line2 || '',
      zip: address.postal_code || '',
      email: order.email || '',
    },
    // Cheapest-first; PrintKK resolves the first one it can serve.
    shippingPriority: ['economy', 'standard', 'express'],
  });

  const orderId = created?.orderId || created?.id;
  if (!orderId) throw new Error('PrintKK accepted the order but returned no id.');

  if (!autoPay()) {
    return { id: String(orderId), status: 'awaiting_payment', paid: false };
  }

  await call('POST', '/api/v1/order/pay', { orderIds: [orderId] });
  return { id: String(orderId), status: 'submitted', paid: true };
}

/**
 * Ask PrintKK where the parcels are.
 * Called on a schedule, because there is no webhook to wait for. Returns one
 * entry per order that has shipped, with tracking filled in where PrintKK has
 * it yet.
 */
export async function refreshShipments(orderIds) {
  const ids = (orderIds || []).filter(Boolean);
  if (!ids.length) return [];
  const data = await call('GET', '/api/v1/order/shipments', { orderIds: ids.join(',') });
  const list = Array.isArray(data) ? data : (data && (data.list || data.records)) || [];
  return list.map((entry) => {
    const shipment = (entry.shipments && entry.shipments[0]) || entry.shipment || entry;
    return {
      supplierOrderId: String(entry.orderId || entry.id || ''),
      carrier: shipment.carrier || shipment.carrierName || null,
      trackingNumber: shipment.trackingNumber || shipment.trackingNo || null,
      trackingUrl: shipment.trackingUrl || null,
      shippedAt: shipment.shipTime || shipment.shippedAt || null,
      status: shipment.status || entry.status || null,
    };
  });
}

export async function cancelOrder(orderId) {
  return call('POST', '/api/v1/order/cancel', { orderIds: [Number(orderId) || orderId] });
}

/** Everything a supplier webhook would have told us, if PrintKK had webhooks. */
export function eventEffect() {
  return null;
}

export function shipmentFromWebhook() {
  return null;
}
