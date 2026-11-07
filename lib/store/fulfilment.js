// Order fulfilment orchestration.
//
// One place decides what happens to a paid order, so the Stripe webhook, the
// supplier webhook and the admin's manual button all behave identically:
//
//   paid ──▶ submitToSupplier ──▶ submitted ──▶ (supplier ships) ──▶ shipped
//                     │
//                     └──▶ failed  (recorded, shown in the admin, retryable)
//
// Two rules matter more than the happy path:
//
//  1. Never submit the same order twice. Printful rejects a duplicate
//     external_id, but relying on that means a retry storm hammers their API.
//     We check our own row first, and write supplier_order_id before confirming.
//
//  2. Never lose a failure. If Printful is down, the order keeps
//     fulfilment_status='failed' with the reason attached, and the admin lists
//     it at the top of Store Orders. A paid customer with no parcel is the one
//     state the shop must never sit in quietly.

import { refreshCatalog } from '../store/catalog.js';
import { updateOrderFulfilment, isFulfilled } from '../store/db.js';
import * as printful from '../suppliers/printful.js';
import * as printkk from '../suppliers/printkk.js';

/**
 * Which supplier makes a given product.
 *
 * Printful carries apparel and stickers; it has no guitar picks. The pick set
 * is on PrintKK. The split lives here rather than in the product rows because
 * it is a fact about the world ("nobody prints picks"), not something the shop
 * owner should be able to misconfigure. A product row can still override it.
 */
const DEFAULT_SUPPLIER_BY_PRODUCT = {
  'connect-picks': 'printkk',
};

const SUPPLIERS = { printful, printkk };

function supplierForProduct(productId, product) {
  if (product && product.supplier) return product.supplier;
  return DEFAULT_SUPPLIER_BY_PRODUCT[productId] || 'printful';
}

/** supplier → variant map for one order, read from the product rows. */
/** Async on purpose: the variant map is edited in the admin, so it must be
 *  read from the database rather than from a cache that may predate the edit. */
async function variantsFor(items) {
  const catalog = await refreshCatalog();
  const variants = {};
  for (const item of items || []) {
    const product = catalog.byId.get(item.productId);
    if (!product || !product.supplierVariants) continue;
    const supply = product.supplierVariants;
    const exact = `${item.productId}|${item.color || item.colorKey || ''}|${item.size || ''}`;
    if (supply[exact]) variants[exact] = supply[exact];
    // "productId|*|*" lets one variant serve every colour/size of a product
    // (stickers, picks) without repeating the id six times.
    if (supply[`${item.productId}|*|*`]) variants[`${item.productId}|*|*`] = supply[`${item.productId}|*|*`];
  }
  return variants;
}

/** Group an order's lines by the supplier that will make them. */
async function supplierGroups(items) {
  const catalog = await refreshCatalog();
  const groups = new Map();
  for (const item of items || []) {
    const product = catalog.byId.get(item.productId);
    const supplier = supplierForProduct(item.productId, product);
    if (!groups.has(supplier)) groups.set(supplier, []);
    groups.get(supplier).push(item);
  }
  return groups;
}

export function supplierStatus() {
  const printfulReady = printful.isConfigured();
  const printkkReady = printkk.isConfigured();
  return {
    // "configured" means at least one supplier can take an order. Reporting
    // only Printful made the panel claim fulfilment was off while PrintKK was
    // perfectly able to ship the pick set.
    configured: printfulReady || printkkReady,
    supplier: printfulReady ? 'printful' : printkkReady ? 'printkk' : null,
    draft: process.env.PRINTFUL_DRAFT === '1',
    autoPay: process.env.PRINTKK_AUTO_PAY === '1',
    suppliers: {
      printful: printfulReady,
      printkk: printkkReady,
    },
  };
}

/** Which supplier, if any, can currently take each product we sell. */
export function supplierReadiness() {
  const printfulReady = printful.isConfigured();
  const printkkReady = printkk.isConfigured();
  return {
    printful: { configured: printfulReady },
    printkk: { configured: printkkReady },
  };
}

/**
 * Push a paid order to the supplier.
 * Returns { ok, skipped?, reason?, id? } and never throws for the expected
 * cases — the caller decides whether that is worth a webhook retry.
 */
export async function submitToSupplier(order) {
  if (!order) return { ok: false, reason: 'No order to submit.' };

  if (isFulfilled(order)) {
    return { ok: true, skipped: true, reason: 'Already submitted to the supplier.', id: order.supplier_order_id };
  }
  if (order.status === 'refunded' || order.status === 'cancelled') {
    return { ok: false, skipped: true, reason: `Order is ${order.status}; not sending it to be printed.` };
  }

  const groups = await supplierGroups(order.items);
  if (!groups.size) return { ok: false, skipped: true, reason: 'This order has no line items.' };

  const variants = await variantsFor(order.items);
  const results = [];
  const notes = [];

  for (const [name, items] of groups) {
    const supplier = SUPPLIERS[name];
    if (!supplier) {
      notes.push(`${name}: unknown supplier`);
      continue;
    }
    if (!supplier.isConfigured()) {
      notes.push(`${name}: not configured, so its lines were not sent`);
      continue;
    }

    try {
      // Suppliers only need to see their own lines — a pick set must never
      // appear in a Printful order, or Printful would reject the whole thing.
      const scoped = { ...order, items };
      const result = await supplier.submitOrder(scoped, variants);

      if (result.skipped) {
        notes.push(`${name}: ${result.reason}`);
        results.push({ supplier: name, skipped: true, reason: result.reason });
        continue;
      }
      results.push({ supplier: name, id: result.id, status: result.status });
    } catch (err) {
      notes.push(`${name}: ${err.message}`);
      results.push({ supplier: name, error: err.message });
    }
  }

  // One status per order, describing the whole thing rather than one parcel.
  const sent = results.filter((r) => r.id);
  const failed = results.filter((r) => r.error);
  const skipped = results.filter((r) => r.skipped);
  const mix = [...new Set(sent.map((r) => r.supplier))];

  const patch = {
    supplier: mix.length === 1 ? mix[0] : mix.join('+') || null,
    supplier_order_id: sent.map((r) => `${r.supplier}:${r.id}`).join(',') || null,
  };

  if (failed.length) {
    patch.fulfilment_status = 'failed';
    patch.fulfilment_error = notes.join(' | ').slice(0, 500);
  } else if (sent.length) {
    // "submitted" covers the happy path; a partially sent order is still
    // submitted but says so, so nobody assumes both parcels left.
    patch.fulfilment_status = skipped.length ? 'partially_submitted' : 'submitted';
    patch.fulfilment_error = skipped.length ? notes.join(' | ').slice(0, 500) : null;
  } else {
    patch.fulfilment_status = 'needs_mapping';
    patch.fulfilment_error = notes.join(' | ').slice(0, 500);
  }

  await updateOrderFulfilment(order.id, patch).catch((dbErr) =>
    console.error('[fulfilment] could not record result', dbErr),
  );

  if (failed.length) return { ok: false, error: patch.fulfilment_error, results };
  if (!sent.length) return { ok: false, skipped: true, reason: patch.fulfilment_error, results };
  return { ok: true, results, status: patch.fulfilment_status };
}

/**
 * Apply a supplier webhook to an order.
 * `order` is the row we found by order number; `effect` comes from
 * printful.eventEffect(type).
 */
export async function applyShipment(order, body, effect) {
  const shipment = printful.shipmentFromWebhook(body);

  const patch = {
    supplier: 'printful',
    fulfilment_status: effect.fulfilment,
  };
  // supplier_order_id may hold "printful:1001,printkk:55" for a split order.
  // A shipment event from one supplier must not overwrite the other's id.
  if (shipment.supplierOrderId && !order.supplier_order_id) {
    patch.supplier_order_id = String(shipment.supplierOrderId);
  }
  if (shipment.carrier) patch.carrier = shipment.carrier;
  if (shipment.trackingNumber) patch.tracking_number = shipment.trackingNumber;
  if (shipment.trackingUrl) patch.tracking_url = shipment.trackingUrl;
  if (effect.fulfilment === 'shipped') patch.shipped_at = shipment.shippedAt;
  if (effect.orderStatus) patch.status = effect.orderStatus;

  return updateOrderFulfilment(order.id, patch);
}

/** Human-readable tracking line, used in the email and the admin. */
export function trackingSummary(order) {
  if (!order || !order.tracking_number) return null;
  const carrier = order.carrier ? `${order.carrier} ` : '';
  return `${carrier}${order.tracking_number}`.trim();
}

/**
 * Poll PrintKK for tracking.
 *
 * PrintKK has no webhooks — their FAQ says so outright — so the only way a
 * pick-set parcel's tracking reaches the customer is by asking. This is called
 * from /api/store/supplier-sync, which Vercel Cron hits on a schedule. It is
 * idempotent: an order already marked shipped is skipped, and only orders that
 * are actually sitting at PrintKK are queried, so the API's 60 requests/minute
 * limit is never a concern at this shop's volume.
 */
export async function syncPrintkkShipments(orders) {
  const pending = (orders || []).filter((order) => {
    const id = String(order.supplier_order_id || '');
    const ours = id.split(',').find((part) => part.startsWith('printkk:'));
    return ours && order.fulfilment_status !== 'shipped';
  });

  if (!pending.length) return { checked: 0, updated: [] };
  if (!printkk.isConfigured()) return { checked: 0, updated: [], reason: 'PRINTKK not configured.' };

  const idMap = new Map();
  for (const order of pending) {
    const part = String(order.supplier_order_id).split(',').find((p) => p.startsWith('printkk:'));
    idMap.set(part.slice('printkk:'.length), order);
  }

  const shipments = await printkk.refreshShipments([...idMap.keys()]);
  const updated = [];

  for (const shipment of shipments) {
    const order = idMap.get(String(shipment.supplierOrderId));
    if (!order || !shipment.trackingNumber) continue;
    if (order.fulfilment_status === 'shipped') continue;

    const row = await updateOrderFulfilment(order.id, {
      carrier: shipment.carrier || order.carrier || null,
      tracking_number: shipment.trackingNumber,
      tracking_url: shipment.trackingUrl || order.tracking_url || null,
      shipped_at: shipment.shippedAt ? new Date(shipment.shippedAt).toISOString() : new Date().toISOString(),
      status: 'shipped',
      fulfilment_status: 'shipped',
    });
    updated.push(row);
  }

  return { checked: pending.length, updated };
}

/**
 * A refund must also stop the parcel.
 *
 * Refunding in Stripe returns the customer's money but does nothing about the
 * supplier — the order is still in their queue and will still be printed and
 * shipped, at our cost. This cancels whatever part of it has not gone into
 * production yet and reports what could not be stopped (a shipped parcel can
 * only be handled as a return).
 */
export async function cancelFulfilment(order) {
  const ids = String((order && order.supplier_order_id) || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (!ids.length) return { cancelled: [], failed: [], reason: 'Nothing had been sent to a supplier.' };
  if (order.fulfilment_status === 'shipped' || order.status === 'shipped') {
    return { cancelled: [], failed: [], reason: 'Already shipped — this can only be handled as a return.' };
  }

  const cancelled = [];
  const failed = [];

  for (const entry of ids) {
    const [name, id] = entry.includes(':') ? entry.split(':') : ['printful', entry];
    try {
      if (name === 'printful') await printful.cancelOrder(id);
      else if (name === 'printkk') await printkk.cancelOrder(id);
      else { failed.push({ supplier: name, id, error: 'Unknown supplier' }); continue; }
      cancelled.push({ supplier: name, id });
    } catch (err) {
      failed.push({ supplier: name, id, error: err.message });
    }
  }

  await updateOrderFulfilment(order.id, {
    fulfilment_status: failed.length ? 'cancel_failed' : 'canceled',
    fulfilment_error: failed.length
      ? failed.map((f) => `${f.supplier}: ${f.error}`).join(' | ').slice(0, 500)
      : 'Cancelled after refund.',
  }).catch((err) => console.error('[fulfilment] could not record cancellation', err));

  return { cancelled, failed };
}
