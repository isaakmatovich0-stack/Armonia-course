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
import { buildOrderPayload } from '../lib/suppliers/printful.js';

const failures = [];
const fail = (message) => failures.push(message);

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

  // A colour photographed once must not be duplicated across its sizes.
  const images = (product && product.images) || {};
  if (Object.values(images).filter((u) => u === shared).length > 1) {
    fail('one mockup was written under two colour keys — a colour is borrowing another colour\'s photo');
  }
}

/* ── stale artwork must be dropped, an owner's upload must not be ────────
   The images the shop is serving right now are Printful artwork files, which
   is why every card looks like a design pasted on its own square. The apply
   step deliberately MERGES, so a colour Printful has no mockup for keeps its
   existing photo — correct for a photo the owner uploaded, wrong for a flat
   design file. Only Printful-CDN pictures Printful no longer offers are stale. */
{
  const printful = [{
    id: 555,
    externalId: 'hat-embroidered',
    name: 'Armonia Connect™ Hat | Embroidered',
    variants: [variant(101, 'Black', '', null)],   // no mockup rendered yet
  }];
  const artwork = 'https://files.cdn.printful.com/files/ART_preview.png';

  // (a) Printful's own artwork file: stale
  {
    const rows = [{
      id: 'hat-embroidered', name: 'Armonia Connect™ Hat | Embroidered',
      colors: ['Black'], sizes: ['ONE SIZE'], price_cents: 2300,
      images: { Black: artwork }, in_stock: true,
    }];
    const product = buildSyncPlan(printful, rows, {}).products[0];
    if (!(product.staleImages || []).includes('Black')) {
      fail('a Printful artwork file was NOT flagged stale — the boxed card would stay boxed after a sync');
    }
  }

  // (b) a photo the owner uploaded: must survive
  {
    const rows = [{
      id: 'hat-embroidered', name: 'Armonia Connect™ Hat | Embroidered',
      colors: ['Black'], sizes: ['ONE SIZE'], price_cents: 2300,
      images: { Black: 'https://example.com/uploads/my-real-mockup.jpg' }, in_stock: true,
    }];
    const product = buildSyncPlan(printful, rows, {}).products[0];
    if ((product.staleImages || []).length) {
      fail("an owner's own uploaded photo was flagged stale — a sync would delete it");
    }
  }
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
