#!/usr/bin/env node
/**
 * Order check — can the shop actually hand a paid order to Printful?
 * ---------------------------------------------------------------------------
 * This is the check that was missing. The storefront rendered, the cart worked,
 * the checkout took money — and `store_products.supplier_variants` was `{}` on
 * every product, so every line of every order came back as `missing` and
 * Printful was never asked to make anything. A shop that takes payment and
 * cannot fulfil is worse than a shop that is closed.
 *
 * Three things have to line up, and they are each maintained in a different
 * file, which is exactly why they drifted:
 *
 *   1. the sync derives `productId|colour|size` → `sync_variant_id`
 *   2. a one-size product is keyed `...|colour|*` but the order line says
 *      "ONE SIZE", so the wildcard has to be consulted
 *   3. the payload Printful receives carries the right id per line
 *
 * No network, no database: pure functions, real shapes.
 *
 * Usage
 *   node store/order-check.mjs
 */

import { buildSyncPlan } from '../lib/store/sync.js';
import { buildOrderPayload, buildShippingRateItems } from '../lib/suppliers/printful.js';
import { clearCatalogCache, priceBag, applyPromo } from '../lib/store/catalog.js';
import { shippingAddress, quoteFingerprint } from '../lib/store/shipping.js';
import { orderFromStripeSession } from '../lib/store/orders.js';
import { withQuotedShipping } from '../lib/store/quoted-order.js';
import { encodeCheckoutItems, decodeCheckoutItems } from '../lib/store/checkout-items.js';

const failures = [];
const fail = (message) => failures.push(message);

{
  const items = Array.from({ length: 20 }, (_, i) => ({ productId: `product-${i}`, name: 'A customer product', color: 'Black', size: 'M', quantity: 1, unitPriceCents: 3000 }));
  const metadata = encodeCheckoutItems(items);
  if (Object.values(metadata).some(value => value.length > 480) || JSON.stringify(decodeCheckoutItems(metadata)) !== JSON.stringify(items)) fail('checkout must preserve large mixed bags across bounded metadata chunks');
}

// Quotes need catalog variant IDs, not the store's fulfillment sync IDs.
{
  const catalog = { byId: new Map([['tee', { supplier: 'printful', supplierVariants: { 'tee|Black|M': '123' } }], ['hat', { supplier: 'printful', supplierVariants: { 'hat|Navy|One size': '124' } }]]) };
  const products = [{ variants: [{ syncVariantId: 123, variantId: 456 }, { syncVariantId: 124, variantId: 457 }] }];
  const items = buildShippingRateItems([{ productId: 'tee', color: 'Black', size: 'M', quantity: 2 }, { productId: 'hat', color: 'Navy', size: 'ONE SIZE', quantity: 1 }], catalog, products);
  if (JSON.stringify(items) !== JSON.stringify([{ variant_id: 456, quantity: 2 }, { variant_id: 457, quantity: 1 }])) fail('shipping must quote the exact catalog variants and quantities');
  try { buildShippingRateItems([{ productId: 'tee', color: 'Black', size: 'L', quantity: 1 }], catalog, products); fail('unmapped variants must fail closed'); } catch { /* expected */ }
  const order = buildOrderPayload({ number: 'test', items: [{ productId: 'hat', color: 'Navy', size: 'ONE SIZE', quantity: 1 }] }, { 'hat|Navy|One size': '124' });
  if (order.missing.length || order.payload.items[0]?.sync_variant_id !== 124) fail('fulfilment must resolve the same legacy one-size mapping as shipping');
}

// Address, cart, price and discount changes invalidate a shipping quote.
{
  const address = shippingAddress({ name: 'Test', line1: '1 Main St', city: 'Spring', state: 'tx', postal_code: '77373' });
  const lines = [{ productId: 'tee', color: 'Black', size: 'M', quantity: 1, unitPriceCents: 3000 }];
  const hash = quoteFingerprint(address, lines, 475, 0);
  if (hash === quoteFingerprint({ ...address, postal_code: '90210' }, lines, 475, 0) || hash === quoteFingerprint(address, [{ ...lines[0], quantity: 2 }], 475, 0) || hash === quoteFingerprint(address, lines, 475, 100)) fail('shipping quote must bind address, cart and discount');
  try { shippingAddress({ ...address, postal_code: 'not a zip' }); fail('invalid ZIP should fail'); } catch { /* expected */ }
  if (applyPromo('FREE', 5000, { code: 'FREE', kind: 'free_shipping', active: true }).valid) fail('free shipping promos must no longer be accepted');
  const session = { id: 'cs_check', amount_subtotal: 3475, amount_total: 3475, metadata: { fixed_shipping_address: 'payment_intent', quoted_shipping_cents: '475' }, shipping_details: { name: 'Test', address: { line1: '1 Main St', city: 'Spring', state: 'TX', postal_code: '77373', country: 'US' } }, customer_details: { name: 'Different billing name', address: { city: 'Billing City' } } };
  const order = orderFromStripeSession(session);
  if (order.amount_subtotal !== 3000 || order.amount_shipping !== 475 || order.shipping_address.city !== 'Spring' || order.name !== 'Test') fail('order must use the quoted destination and record shipping separately');
}

{
  const session = { payment_intent: 'pi_test', metadata: { fixed_shipping_address: 'payment_intent' }, customer_details: { address: { city: 'Wrong billing address' } } };
  const stripe = { paymentIntents: { retrieve: async () => ({ shipping: { name: 'Customer', address: { line1: '1 Main St', city: 'Spring', state: 'TX', postal_code: '77373', country: 'US' } } }) } };
  const enriched = await withQuotedShipping(session, stripe);
  if (enriched.shipping_details?.address.city !== 'Spring') fail('webhook must retrieve quoted shipping address');
  try { await withQuotedShipping(session, { paymentIntents: { retrieve: async () => ({}) } }); fail('missing quoted address must fail closed'); } catch { /* expected */ }
}

// Checkout must charge the selected variant, not just the advertised base.
{
  clearCatalogCache();
  const bag = priceBag([
    { productId: 'windbreaker-embroidered', color: 'Black', size: 'M', quantity: 1 },
    { productId: 'windbreaker-embroidered', color: 'Navy', size: '2XL', quantity: 2 },
  ]);
  if (bag.lines[0]?.unitPriceCents !== 4500 || bag.lines[1]?.unitPriceCents !== 4550 || bag.subtotalCents !== 13600) fail('variant prices must be enforced server-side in the bag and checkout');
}

const variant = (syncVariantId, colour, size, shot) => ({
  syncVariantId,
  colour,
  size,
  price: '23.00',
  // Distinct per colour, shared across sizes of one colour — the real shape.
  preview: shot,
  previews: shot ? [shot] : [],
  thumbnail: shot,
  artwork: 'https://files.cdn.printful.com/files/art.png',
  hasMockup: Boolean(shot),
});

/* ── a one-size product (cap) ─────────────────────────────────────────── */
{
  const printful = [{
    id: 555,
    externalId: 'hat-embroidered',
    name: 'Armonia Connect™ Hat | Embroidered',
    variants: [
      variant(101, 'Black', '', 'https://files.cdn.printful.com/files/hat-black.png'),
      variant(103, 'Navy Blue', '', 'https://files.cdn.printful.com/files/hat-navy.png'),
    ],
  }];
  const rows = [{
    id: 'hat-embroidered',
    name: 'Armonia Connect™ Hat | Embroidered',
    colors: ['Black', 'Navy Blue'],
    sizes: ['ONE SIZE'],
    price_cents: 2300,
    images: {},
    in_stock: true,
  }];

  const plan = buildSyncPlan(printful, rows, {});
  const product = plan.products[0];

  if (!product) {
    fail('the cap did not survive the sync plan');
  } else {
    // 1. the map exists
    const map = product.supplierVariants || {};
    if (!Object.keys(map).length) {
      fail('the sync derived no variant map for the cap — nothing could ever be ordered');
    } else if (map['hat-embroidered|Navy Blue|*'] !== '103') {
      fail(`the cap's Navy Blue variant did not map to Printful id 103 (got ${JSON.stringify(map)})`);
    }

    // 2. per-colour photographs arrive, and the flat artwork never does
    const images = product.images || {};
    if (Object.keys(images).length !== 2) {
      fail(`the cap should get one mockup per colour, got ${Object.keys(images).length}`);
    }
    if (Object.values(images).some((url) => String(url).includes('/art.png'))) {
      fail('the print file leaked in as a product photo — that is the boxed-background bug');
    }

    // 3. an order line for a one-size product resolves
    const order = {
      number: 'AC-CHECK-1',
      name: 'Check',
      email: 'check@example.com',
      shipping_address: { line1: '1 Lane', city: 'Spring', state: 'TX', postal_code: '77373', country: 'US' },
      items: [
        { productId: 'hat-embroidered', colorName: 'Navy Blue', size: 'ONE SIZE', quantity: 1, unitPriceCents: 2300 },
        { productId: 'hat-embroidered', colorName: 'Black', size: 'ONE SIZE', quantity: 2, unitPriceCents: 2300 },
      ],
    };
    const { payload, missing, empty } = buildOrderPayload(order, map);
    if (empty || missing.length) {
      fail(`a one-size order line did not map: missing ${JSON.stringify(missing)} — the shop would take money and never fulfil`);
    }
    const ids = (payload.items || []).map((i) => i.sync_variant_id);
    if (ids.join(',') !== '103,101') {
      fail(`the cap's order carried the wrong Printful ids (${ids.join(',') || 'none'}, expected 103,101)`);
    }
  }
}

/* ── a sized product (tee), where every size is its own variant ────────── */
{
  const shared = 'https://files.cdn.printful.com/files/tee-maroon.png';
  const printful = [{
    id: 777,
    externalId: 'unisex-classic-tee',
    name: 'Unisex classic tee',
    variants: [
      variant(201, 'Maroon', 'M', shared),
      variant(202, 'Maroon', 'L', shared),
      variant(203, 'Black', 'M', 'https://files.cdn.printful.com/files/tee-black.png'),
    ],
  }];
  const rows = [{
    id: 'unisex-classic-tee',
    name: 'Unisex classic tee',
    colors: ['Maroon', 'Black'],
    sizes: ['M', 'L'],
    price_cents: 2050,
    images: {},
    in_stock: true,
  }];

  const product = buildSyncPlan(printful, rows, {}).products[0];
  const map = (product && product.supplierVariants) || {};

  const order = {
    number: 'AC-CHECK-2',
    name: 'Check',
    email: 'check@example.com',
    shipping_address: { line1: '1 Lane', city: 'Spring', state: 'TX', postal_code: '77373', country: 'US' },
    items: [
      { productId: 'unisex-classic-tee', colorName: 'Maroon', size: 'M', quantity: 1, unitPriceCents: 2050 },
      { productId: 'unisex-classic-tee', colorName: 'Maroon', size: 'L', quantity: 1, unitPriceCents: 2050 },
      { productId: 'unisex-classic-tee', colorName: 'Black', size: 'M', quantity: 1, unitPriceCents: 2050 },
    ],
  };
  const { payload, missing } = buildOrderPayload(order, map);
  if (missing.length) {
    fail(`a sized order line did not map: ${JSON.stringify(missing)}`);
  }
  const ids = (payload.items || []).map((i) => i.sync_variant_id);
  if (ids.join(',') !== '201,202,203') {
    fail(`the tee's sizes did not each resolve to their own variant (${ids.join(',') || 'none'}, expected 201,202,203)`);
  }

  // Identical URLs for multiple sizes of the SAME colour are valid.
  if (product.images.Maroon !== shared) fail('a photo repeated across sizes of the same colour was wrongly discarded');
  // A colour photographed once must not be duplicated across its sizes.
  const images = (product && product.images) || {};
  if (Object.values(images).filter((u) => u === shared).length > 1) {
    fail('one mockup was written under two colour keys — a colour is borrowing another colour\'s photo');
  }
}

/* Existing URLs must never be classified as artwork solely by host. */
{
  const printful = [{ id: 555, externalId: 'hat-embroidered', name: 'Hat',
    variants: [variant(101, 'Black', '', null)] }];
  const rows = [{ id: 'hat-embroidered', name: 'Hat', colors: ['Black'],
    sizes: ['ONE SIZE'], images: { Black: 'https://files.cdn.printful.com/files/photo.png' }, in_stock: true }];
  const product = buildSyncPlan(printful, rows, {}).products[0];
  if ((product.staleImages || []).length) fail('a CDN photo was incorrectly marked for deletion');
}

/* ── the negative case: an unmapped line is reported, never guessed ────── */
{
  const order = {
    number: 'AC-CHECK-3',
    name: 'Check',
    email: 'check@example.com',
    shipping_address: { line1: '1 Lane', city: 'Spring', state: 'TX', postal_code: '77373', country: 'US' },
    items: [{ productId: 'unknown-product', colorName: 'Black', size: 'M', quantity: 1, unitPriceCents: 999 }],
  };
  const { missing, empty } = buildOrderPayload(order, {});
  if (!empty || !missing.length) {
    fail('an unmapped product was silently turned into an order — Printful would be asked to ship nothing');
  }
}

if (failures.length) {
  console.log('  ✗ order check — a paid order could not reach Printful:');
  for (const message of failures) console.log(`      ${message}`);
  process.exit(1);
}

console.log('  ✓ order check — every colour and size resolves to a Printful variant id');
process.exit(0);
