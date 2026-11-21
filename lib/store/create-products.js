// Creating the Printful products, instead of clicking them into existence.
//
// A Printful store starts empty, and every product has to exist there before an
// order can be placed — a sync can only read what is already in it. Doing six
// products by hand is an hour of clicking where one wrong variant id prints the
// wrong garment forever, and the artwork sits in the repo either way.
//
// So: read store/printful-products.json, publish the artwork to a public URL,
// and drive POST /store/products.
//
// The deliberate hole is catalogVariantId. Printful's catalog ids are specific
// versioned blanks (Bella+Canvas 3001, Gildan 18500, …) and a plausible-looking
// guess is worse than a blank: it is a real garment the customer did not order.
// With no variant id, plan() reports what is missing and creates nothing. Fill
// them in once and creation is repeatable.

import fs from 'node:fs';
import path from 'node:path';

const MANIFEST = path.resolve(process.cwd(), 'store/printful-products.json');
const ART_DIR = path.resolve(process.cwd(), 'public/store/print');

export function loadManifest() {
  const raw = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  return raw.products || [];
}

/** Printful file `type` → what the customer sees. Used for the preview. */
const PLACEMENT_LABEL = {
  default: 'front',
  back: 'back',
  front: 'front',
  embroidery_front: 'embroidered front',
  embroidery_back: 'embroidered back',
  sleeve_left: 'left sleeve',
  sleeve_right: 'right sleeve',
};

/**
 * Work out what would be created, and what is missing. Pure — no network.
 *
 * @param manifest   rows from store/printful-products.json
 * @param baseUrl    public origin, e.g. https://www.armoniaconnect.com
 * @param existing   names already in the Printful store
 */
export function planCreation(manifest, baseUrl, existing = []) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const existingNames = new Set(existing.map((n) => String(n || '').toLowerCase().trim()));

  const ready = [];
  const blocked = [];
  const skipped = [];

  for (const product of manifest || []) {
    if (existingNames.has(String(product.name).toLowerCase().trim())) {
      skipped.push({ id: product.id, name: product.name, reason: 'already in the Printful store' });
      continue;
    }

    const problems = [];
    if (!product.catalogVariantId) problems.push('no catalogVariantId — the blank has not been chosen');

    const files = [];
    for (const [type, filename] of Object.entries(product.placements || {})) {
      const onDisk = path.join(ART_DIR, filename);
      if (!fs.existsSync(onDisk)) {
        problems.push(`artwork ${filename} is not in public/store/print/`);
        continue;
      }
      files.push({
        type,
        placement: PLACEMENT_LABEL[type] || type,
        url: `${base}/store/print/${filename}`,
        filename,
        bytes: fs.statSync(onDisk).size,
      });
    }
    if (!files.length) problems.push('no print files');

    if (problems.length) {
      blocked.push({ id: product.id, name: product.name, problems });
      continue;
    }

    ready.push({
      id: product.id,
      name: product.name,
      catalogProductId: product.catalogProductId || null,
      catalogVariantId: Number(product.catalogVariantId),
      files,
      // Printful mints one sync variant per catalog variant; ours is 1:1 with
      // the chosen blank until sizes differ per colour.
      request: {
        sync_product: { name: product.name, external_id: product.id },
        sync_variants: [
          {
            variant_id: Number(product.catalogVariantId),
            retail_price: null,   // left to Printful; our price lives in our DB
            files: files.map((f) => ({ type: f.type, url: f.url })),
          },
        ],
      },
    });
  }

  return {
    ready,
    blocked,
    skipped,
    summary: { ready: ready.length, blocked: blocked.length, skipped: skipped.length },
  };
}

/** Publish the plan to Printful. Returns per-product outcomes. */
export async function applyCreation(plan, { createProduct }) {
  const created = [];
  const failed = [];
  for (const item of plan.ready) {
    try {
      const res = await createProduct(item.request);
      const syncProduct = (res && res.result && res.result.sync_product) || {};
      const variants = (res && res.result && res.result.sync_variants) || [];
      created.push({
        id: item.id,
        name: item.name,
        printfulProductId: syncProduct.id || null,
        // The ids our fulfilment code needs, handed back immediately so the
        // mapping does not have to be re-imported straight afterwards.
        syncVariantIds: variants.map((v) => ({ id: v.id, name: v.name })),
      });
    } catch (err) {
      failed.push({ id: item.id, name: item.name, error: err.message });
    }
  }
  return { created, failed };
}
