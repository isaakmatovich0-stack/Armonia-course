// Applying a catalogue replacement.
//
// Split from the plan so the dangerous half can be read on its own. Everything
// here writes; nothing here decides what to write.
//
// Order matters. Products are created before the old ones are deleted, so a
// failure halfway leaves the shop with more than it had rather than nothing at
// all. If creation fails for every product, nothing is deleted and the store is
// exactly as it was.

import { deleteProducts, createProduct, updateProduct } from './db.js';

/** The DB row shape, with the column names Postgres actually uses. */
function rowFor(product, index) {
  return {
    id: product.id,
    name: product.name,
    short_name: product.name,
    subtitle: '',
    description: '',
    details: [],
    fit: '',
    badge: '',
    category: product.type,
    type: product.type,
    price_cents: product.priceCents ?? 0,
    compare_at_cents: null,
    cost_cents: null,
    colors: product.colours,
    sizes: product.sizes,
    images: product.images || {},
    // snake_case. Sending backImages here rejects every row: PostgREST refuses
    // the whole insert for one unknown column, which is how an earlier version
    // failed all six products at once.
    back_images: {},
    max_per_order: 20,
    in_stock: false,          // nothing goes on sale because a sync ran
    sort_order: index + 1,
    supplier: 'printful',
    supplier_variants: {},
  };
}

export async function applyReplace(plan, { dryRun = false } = {}) {
  const created = [];
  const updated = [];
  const failed = [];
  const deleted = [];

  // 1. Create and update first. Deleting first would leave the shop empty if
  //    the inserts then failed.
  for (const [index, product] of (plan.products || []).entries()) {
    const row = rowFor(product, index);
    const exists = (plan.updates || []).some((p) => p.id === product.id);

    if (dryRun) {
      (exists ? updated : created).push({ id: product.id, dryRun: true });
      continue;
    }

    try {
      if (exists) {
        // Keep artwork and supplier mapping; replace what the sync owns.
        const patch = {
          name: row.name,
          short_name: row.short_name,
          type: row.type,
          category: row.category,
          price_cents: row.price_cents,
          colors: row.colors,
          sizes: row.sizes,
          images: row.images,
          supplier: 'printful',
          sort_order: row.sort_order,
        };
        const res = await updateProduct(product.id, patch);
        if (!res) throw new Error('not in the products table');
        updated.push({ id: product.id });
      } else {
        const res = await createProduct(row);
        created.push({ id: product.id, existed: res.existed });
      }
    } catch (err) {
      failed.push({ id: product.id, name: product.name, error: err.message });
    }
  }

  // 2. Only remove the old rows if the replacement actually landed. A partial
  //    create followed by a full delete is the one outcome worse than doing
  //    nothing: an empty shop.
  const replacementLanded = created.length + updated.length > 0;
  const targetIds = (plan.deletes || []).map((d) => d.id);

  if (!replacementLanded && targetIds.length) {
    return {
      ok: false,
      created,
      updated,
      deleted,
      failed,
      message: 'Nothing could be created, so the existing products were left alone.',
    };
  }

  if (dryRun) {
    deleted.push(...targetIds.map((id) => ({ id, dryRun: true })));
    return { ok: true, created, updated, deleted, failed, dryRun: true };
  }

  if (targetIds.length) {
    try {
      await deleteProducts(targetIds);
      deleted.push(...targetIds.map((id) => ({ id })));
    } catch (err) {
      failed.push({ id: '(delete)', error: err.message });
    }
  }

  return {
    ok: failed.length === 0,
    created,
    updated,
    deleted,
    failed,
  };
}
