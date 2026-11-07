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

export function supplierStatus() {
  return {
    configured: printful.isConfigured(),
    supplier: 'printful',
    draft: process.env.PRINTFUL_DRAFT === '1',
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
  if (!printful.isConfigured()) {
    return { ok: false, skipped: true, reason: 'PRINTFUL_API_TOKEN is not set, so nothing was sent.' };
  }
  if (order.status === 'refunded' || order.status === 'cancelled') {
    return { ok: false, skipped: true, reason: `Order is ${order.status}; not sending it to be printed.` };
  }

  const variants = await variantsFor(order.items);

  try {
    const result = await printful.submitOrder(order, variants);

    if (result.skipped) {
      await updateOrderFulfilment(order.id, {
        fulfilment_status: 'needs_mapping',
        fulfilment_error: result.reason,
        supplier: 'printful',
      });
      return { ok: false, skipped: true, reason: result.reason, missing: result.missing };
    }

    await updateOrderFulfilment(order.id, {
      supplier: 'printful',
      supplier_order_id: String(result.id),
      fulfilment_status: result.status,
      fulfilment_error: null,
    });
    return { ok: true, id: result.id, status: result.status };
  } catch (err) {
    await updateOrderFulfilment(order.id, {
      supplier: 'printful',
      fulfilment_status: 'failed',
      fulfilment_error: err.message.slice(0, 500),
    }).catch((dbErr) => console.error('[fulfilment] could not record failure', dbErr));
    return { ok: false, error: err.message };
  }
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
  if (shipment.supplierOrderId) patch.supplier_order_id = String(shipment.supplierOrderId);
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
