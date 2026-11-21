// Replacing the storefront catalogue with what is actually in Printful.
//
// The six products on the live store were invented from a design brief: names,
// colours and prices that described a collection nobody had ordered yet. The
// Printful store now holds the real ones. Keeping both would mean selling six
// things that do not exist next to six that do.
//
// This is a replace, not a merge, and that is deliberate — but it is also the
// one operation here that destroys data, so it is built to be reviewable first:
//
//   • plan() is pure. It takes the Printful list and the current rows and
//     returns what would be deleted, created and changed. No network, no writes.
//   • apply() requires the plan's fingerprint back, so the thing that gets
//     written is the thing a human looked at. A stale plan is refused.
//   • Deletion is by id, naming every row, never a blanket "delete all".
//   • New products arrive out of stock. Nothing goes on sale because a sync ran.

const SLUG_STRIP = /[^a-z0-9]+/g;

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/armonia[- ]connect[- ]?/g, '')
    .replace(SLUG_STRIP, '-')
    .replace(/^-|-$/g, '');
}

// Which storefront renderer each product gets. `type` drives both the image
// path and the sizing UI, and the frontend only renders photographs for the
// types in its list (see the 'extra product types' patch in build-store.mjs).
function typeFor(printfulName) {
  const n = String(printfulName || '').toLowerCase();
  if (n.includes('beanie')) return 'beanie';
  if (n.includes('hat') || n.includes('cap')) return 'cap';
  if (n.includes('hoodie')) return 'hoodie';
  if (n.includes('windbreaker') || n.includes('jacket')) return 'windbreaker';
  if (n.includes('sticker')) return 'stickers';
  if (n.includes('pick')) return 'picks';
  if (n.includes('tee') || n.includes('shirt')) return 'tee';
  return 'custom';
}

/** A stable id from the Printful product name, so re-running does not churn ids. */
export function productIdFor(printfulName, taken = new Set()) {
  const base = slug(printfulName) || 'product';
  if (!taken.has(base)) return base;
  // Same name twice in one store is a duplicate product, not a new one, but it
  // must not silently overwrite — suffix it so both survive and the human sees it.
  let i = 2;
  while (taken.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

/**
 * Work out the replacement. Pure.
 *
 * @param printfulProducts  from printful.listSyncProducts()
 * @param currentRows       rows from db.listProducts()
 * @param colourDefs        existing colour map, for names/hexes we already have
 */
export function planReplace(printfulProducts, currentRows, colourDefs = {}) {
  const rows = currentRows || [];
  const colours = { ...(colourDefs || {}) };
  const problems = [];
  const products = [];

  const taken = new Set();
  // Reuse an existing id when the Printful product already maps to it, so a
  // second run updates rather than creating "-2" duplicates.
  const byExternal = new Map();
  const byNameGuess = new Map();
  for (const row of rows) {
    byExternal.set(row.id, row);
    byNameGuess.set(String(row.name || '').toLowerCase().trim(), row);
  }

  for (const pf of printfulProducts || []) {
    const variants = pf.variants || [];
    if (!variants.length) {
      problems.push({ product: pf.name, message: `"${pf.name}" has no variants, so there is nothing to sell.` });
      continue;
    }

    // Id: explicit external_id first, then a name match, then a fresh slug.
    let id = null;
    if (pf.externalId && byExternal.has(pf.externalId)) id = pf.externalId;
    if (!id) {
      const match = byNameGuess.get(String(pf.name).toLowerCase().trim());
      if (match) id = match.id;
    }
    if (!id) id = productIdFor(pf.name, taken);
    taken.add(id);

    const colourKeys = [];
    const images = {};
    const sizes = new Set();
    const prices = [];

    for (const v of variants) {
      const key = slug(v.colour || 'default');
      if (key && !colourKeys.includes(key)) colourKeys.push(key);
      if (key && !images[key]) {
        const shot = v.preview || v.thumbnail || null;
        if (shot) images[key] = shot;
      }
      if (!colours[key] && v.colour) {
        colours[key] = { name: String(v.colour).trim(), hex: null };
      }
      if (v.size) sizes.add(String(v.size).toUpperCase());
      const price = Number(v.price);
      if (Number.isFinite(price) && price > 0) prices.push(price);
    }

    const priceCents = prices.length ? Math.round(Math.min(...prices) * 100) : null;
    if (priceCents === null) {
      problems.push({ product: pf.name, message: `Printful returned no retail price for "${pf.name}".` });
    }

    const sizeList = sizes.size ? [...sizes] : ['OS'];

    products.push({
      id,
      name: pf.name,                    // the Printful name, verbatim
      type: typeFor(pf.name),
      printfulProductId: pf.id,
      priceCents,
      colours: colourKeys,
      sizes: sizeList,
      images,
      variantCount: variants.length,
    });
  }

  // Everything currently on the store that is not part of the replacement.
  const kept = new Set(products.map((p) => p.id));
  const toDelete = rows
    .filter((row) => !kept.has(row.id))
    .map((row) => ({ id: row.id, name: row.name }));

  const updates = products.filter((p) => rows.some((r) => r.id === p.id));
  const creates = products.filter((p) => !rows.some((r) => r.id === p.id));

  return {
    products,
    creates,
    updates,
    deletes: toDelete,
    colours,
    problems,
    // Identifies exactly this plan. Apply() refuses anything else, so a plan
    // reviewed before a change cannot be replayed after it.
    fingerprint: fingerprintOf(products, toDelete),
    summary: {
      create: creates.length,
      update: updates.length,
      delete: toDelete.length,
      problems: problems.length,
    },
  };
}

function fingerprintOf(products, deletes) {
  const shape = [
    ...products.map((p) => `${p.id}:${p.priceCents}:${p.colours.join('+')}:${p.sizes.join('+')}`).sort(),
    '--delete--',
    ...deletes.map((d) => d.id).sort(),
  ].join('|');
  // Small, stable, dependency-free hash. Not security — just "is this the same
  // plan the human saw".
  let h = 0;
  for (let i = 0; i < shape.length; i += 1) {
    h = (h * 31 + shape.charCodeAt(i)) | 0;
  }
  return `${shape.length}-${(h >>> 0).toString(36)}`;
}
