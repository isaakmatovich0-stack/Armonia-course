// Order records for the store.
//
// One row per completed Stripe Checkout Session. The webhook (api/store/[...slug].js)
// creates it, api/store/order.js reads it back for the confirmation screen,
// and the admin panel lists it. Amounts are stored in cents, exactly as Stripe
// reports them, so receipts and reports never drift from what was charged.

import crypto from 'node:crypto';
import { insertOrder, findOrderBySession } from './db.js';

const ALPHABET = 'ACDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L — readable over the phone

export function orderNumber() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let index = 0; index < 6; index += 1) out += ALPHABET[bytes[index] % ALPHABET.length];
  return `AC-${out}`;
}

export function orderFromStripeSession(session, { cartId = null, items = [] } = {}) {
  const details = session.customer_details || {};
  const shipping = session.shipping_details || session.collected_information?.shipping_details || null;
  const address = shipping?.address || details.address || null;

  return {
    stripe_session_id: session.id,
    stripe_payment_intent_id:
      typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null,
    number: orderNumber(),
    email: details.email || session.customer_email || null,
    name: details.name || shipping?.name || null,
    phone: details.phone || null,
    amount_subtotal: session.amount_subtotal ?? null,
    amount_shipping: session.total_details?.amount_shipping ?? null,
    amount_tax: session.total_details?.amount_tax ?? null,
    amount_discount: session.total_details?.amount_discount ?? 0,
    amount_total: session.amount_total ?? null,
    currency: session.currency || 'usd',
    items,
    shipping_address: address,
    cart_id: cartId || session.metadata?.cart_id || null,
    promo_code: session.metadata?.promo_code || null,
    status: 'paid',
    paid_at: new Date(((session.created || Math.floor(Date.now() / 1000)) * 1000)).toISOString(),
  };
}

/** Insert an order; returns the existing row when the webhook is retried. */
export async function upsertOrder(record) {
  return insertOrder(record);
}

export { findOrderBySession };

/** Shape an order row for the browser (no internal ids, no payment intent). */
export function publicOrder(row) {
  const items = Array.isArray(row.items) ? row.items : [];
  return {
    number: row.number,
    email: maskEmail(row.email),
    name: row.name,
    status: row.status,
    totalCents: row.amount_total,
    subtotalCents: row.amount_subtotal,
    shippingCents: row.amount_shipping,
    taxCents: row.amount_tax,
    discountCents: row.amount_discount,
    itemCount: items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
    items: items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      color: item.color,
      size: item.size,
    })),
    createdAt: row.paid_at || row.created_at,
  };
}

function maskEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return null;
  const [user, domain] = email.split('@');
  if (user.length <= 2) return `${user[0] || '*'}***@${domain}`;
  return `${user.slice(0, 2)}${'*'.repeat(Math.min(6, user.length - 2))}@${domain}`;
}

/** Flatten a priced bag into the metadata Stripe will hand back to us. */
export function itemsForMetadata(bag, { maxChars = 480 } = {}) {
  const items = bag.lines.map((line) => ({
    productId: line.productId,
    name: line.shortName,
    color: line.colorName,
    size: line.size,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
  }));
  // Stripe metadata values are capped at 500 characters each.
  const json = JSON.stringify(items);
  if (json.length <= maxChars) return items;
  return items.map((item) => ({ ...item, name: String(item.name).slice(0, 24) }));
}
