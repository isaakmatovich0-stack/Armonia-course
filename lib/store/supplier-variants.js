// Resolve the stored Printful mapping without guessing between distinct variants.
// Some legacy one-size mappings say "One size" while the UI says "ONE SIZE".
export function resolveSupplierVariant(variants, productId, colour, size) {
  const keys = [`${productId}|${colour}|${size}`, `${productId}|${colour}|*`, `${productId}|*|*`];
  for (const key of keys) {
    if (variants[key]) return variants[key];
    const matches = Object.keys(variants).filter(k => k.toLowerCase() === key.toLowerCase());
    if (matches.length === 1 && variants[matches[0]]) return variants[matches[0]];
    if (matches.length > 1) throw new Error(`Ambiguous supplier mapping for ${key}.`);
  }
  return null;
}

// Local file-only development has no supplier mappings. In production, reject
// missing or invalid Printful variants before a shopper reaches shipping.
export function isAddableSupplierVariant(product, colour, size, { local = false } = {}) {
  if (local || product.supplier !== 'printful') return true;
  const id = Number(resolveSupplierVariant(product.supplierVariants || {}, product.id, colour, size));
  return Number.isSafeInteger(id) && id > 0;
}
