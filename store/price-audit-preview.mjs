// Temporary read-only Printful price audit; only runs in a preview build.
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
import { listSyncProducts } from '../lib/suppliers/printful.js';
const products = await listSyncProducts();
for (const p of products) {
  console.log('PRINTFUL_RETAIL_AUDIT', JSON.stringify({id:p.id, externalId:p.externalId, name:p.name, variants:p.variants.map(v=>({id:v.syncVariantId, colour:v.colour, size:v.size, retailPrice:v.price}))}));
}
