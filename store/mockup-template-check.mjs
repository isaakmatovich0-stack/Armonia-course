import assert from 'node:assert/strict';
import { templateVariants, imagesForTask } from '../lib/store/mockup-photos.js';
import { storeMockup } from '../lib/store/mockup-storage.js';

process.env.PRINTFUL_API_TOKEN = 'test-only';
process.env.PRINTFUL_STORE_ID = '1';
const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
  const result = url.includes('/product-templates?')
    ? { items: [{ id: 123, product_id: 71, title: 'Saved design', available_variant_ids: [4011,4012] }] }
    : url.includes('/create-task/') ? { task_key: 'gt-123' } : { status: 'completed', mockups: [] };
  return { ok: true, text: async () => JSON.stringify({ result, paging: { total: 1 } }) };
};
const { listProductTemplates, startTemplateMockup, getTemplateMockup } = await import('../lib/suppliers/printful.js');
const [template] = await listProductTemplates();
const row = { colors: ['Black','Navy'] };
const pf = { variants: [
  { variantId: 4011, catalogProductId: 71, colour: 'Black' },
  { variantId: 4012, catalogProductId: 71, colour: 'Navy' },
  { variantId: 999, catalogProductId: 999, colour: 'Black' },
] };
const colours = templateVariants(row, pf, template);
assert.deepEqual(colours, { Black: 4011, Navy: 4012 });
const key = await startTemplateMockup(template.product_id, template.id, Object.values(colours));
assert.equal(key, 'gt-123');
assert.match(calls[1].url, /\/mockup-generator\/create-task\/71$/);
assert.deepEqual(calls[1].body, { product_template_id: 123, variant_ids: [4011,4012], format: 'png' });
assert(!('files' in calls[1].body), 'do not recreate or reposition the template artwork');
assert.equal((await getTemplateMockup(key)).status, 'completed');
const images = imagesForTask({ mockups: [
  { placement:'back', variant_ids:[4011], mockup_url:'https://example.com/back' },
  { placement:'front', variant_ids:[4011], mockup_url:'https://example.com/front' },
  { placement:'front', variant_ids:[4012], mockup_url:'https://example.com/navy' },
] }, colours);
assert.equal(images.Black.url, 'https://example.com/front');
assert.equal(images.Navy.url, 'https://example.com/navy');
const saved = [];
const storage = { from(name) { assert.equal(name,'site-images'); return {
  upload: async (path, data, opts) => { saved.push({path, data, opts}); return { error:null }; },
  getPublicUrl: (path) => ({ data:{ publicUrl:`https://example.com/${path}` } }),
}; } };
const png = Buffer.from([137,80,78,71,13,10,26,10,0]);
const fakeFetch = async () => new Response(png, { status:200, headers:{ 'content-type':'image/png' } });
const publicUrl = await storeMockup('https://printful-upload.s3-accelerate.amazonaws.com/tmp/123/image.png', storage, fakeFetch);
assert.match(publicUrl, /^https:\/\/example\.com\/store-mockups\//);
assert.equal(saved[0].opts.contentType,'image/png');
await assert.rejects(() => storeMockup('http://localhost/private', storage, fakeFetch), /unsupported image host/);
await assert.rejects(() => storeMockup('https://evil.example/file.png', storage, fakeFetch), /unsupported image host/);
await assert.rejects(() => storeMockup('https://printful-upload.s3-accelerate.amazonaws.com/tmp/a', storage, async () => new Response('not an image')), /PNG or JPEG/);
console.log('  ✓ template mockups — original design referenced, temporary image copied, unsafe hosts rejected');
