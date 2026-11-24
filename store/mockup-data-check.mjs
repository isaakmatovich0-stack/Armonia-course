import assert from 'node:assert/strict';
import { findMockupPhotos, mergeMissingPhotos } from '../lib/store/mockup-photos.js';
import { buildSyncPlan } from '../lib/store/sync.js';

process.env.PRINTFUL_API_TOKEN = 'test-only';
process.env.PRINTFUL_STORE_ID = '1';
const make = (id, color, size, preview) => ({
  id, variant_id: id + 1000, color, size, retail_price: '20.00',
  product: { product_id: 71 },
  files: [
    { type: 'default', url: 'https://example.com/art.png', preview_url: 'https://example.com/art-preview.png' },
    ...(preview ? [{ type: 'preview', preview_url: preview }] : []),
  ],
});
const variants = [make(1, 'Black', 'S', 'https://example.com/black.png'), make(2, 'Black', 'M', 'https://example.com/black.png'), make(3, 'Navy', 'S', 'https://example.com/navy.png'), make(4, '', '', null), make(5, 'Maroon', 'S', 'https://example.com/maroon.png')];
variants[4].files[1].filename = 'unisex-classic-tee-maroon-back-6b014756d8022.jpg';
globalThis.fetch = async (url) => ({ ok: true, text: async () => JSON.stringify(url.endsWith('/store/products')
  ? { result: [{ id: 123 }] }
  : url.endsWith('/products/71') ? { result: { variants: [{ id: 1004, color: 'White', size: 'S' }] } }
  : { result: { sync_product: { id: 123, external_id: 'shirt', name: 'Shirt' }, sync_variants: variants } }) });
const { listSyncProducts } = await import('../lib/suppliers/printful.js');
const products = await listSyncProducts();
assert.equal(products[0].variants[3].preview, null, 'print-file preview must not be treated as a mockup');
assert.equal(products[0].variants[3].colour, 'White', 'catalog metadata supplies missing variant colour');
assert.equal(products[0].variants[3].size, 'S');
assert.equal(products[0].variants[0].preview, 'https://example.com/black.png');
assert.equal(products[0].variants[4].preview, null, 'a back-labelled mockup must not populate front images');
assert.equal(products[0].variants[0].catalogProductId, 71);
const rows = [{ id: 'shirt', name: 'Shirt', colors: ['Black', 'Navy', 'White'], sizes: ['S','M'], images: { Navy: 'https://example.com/owner.png' }, in_stock: true }];
const [candidate] = findMockupPhotos(products, rows);
assert.deepEqual(candidate.importable, { Black: 'https://example.com/black.png' }, 'only missing, unambiguous photos may be imported');
assert.equal(candidate.colours.find((c) => c.name === 'Navy').photo, 'https://example.com/owner.png');
const planned = buildSyncPlan(products, rows, {}).products[0];
assert.equal(planned.images.Black, 'https://example.com/black.png', 'repetition across sizes is not a different colour');
assert.equal(planned.images.White, undefined);
const ambiguous = [{ ...products[0], variants: [products[0].variants[0], { ...products[0].variants[2], preview: 'https://example.com/black.png' }] }];
assert.deepEqual(findMockupPhotos(ambiguous, [{ ...rows[0], images: {} }])[0].importable, {}, 'same image for two colours is ambiguous');
assert.equal(buildSyncPlan(ambiguous, rows, {}).products[0].images.Black, undefined);
assert.equal(findMockupPhotos([{ ...products[0], externalId: 'different', name: 'Shirt long sleeve' }], rows)[0].matched, false, 'partial names cannot identify a product');
const temporary = [{ ...products[0], variants: [{ ...products[0].variants[0], preview: 'https://example.com/tmp/file.png' }] }];
assert.deepEqual(findMockupPhotos(temporary, rows)[0].importable, {}, 'temporary task URLs must not be imported');
assert.deepEqual(mergeMissingPhotos({ Black: 'https://files.cdn.printful.com/old.png' }, { Black: 'new', Navy: 'navy', White: 'white' }, ['Black','Navy']), { images: { Black: 'https://files.cdn.printful.com/old.png', Navy: 'navy' }, added: 1 });
console.log('  ✓ mockup data — print artwork excluded; colour ambiguity and existing photos protected');
