// Conservative candidates only: explicit product matches and variant files
// labelled "preview" by Printful. Sharing one URL across different colours is
// ambiguous; sharing it across sizes of the same colour is fine.
// Known temporary task URLs expire; exclude /tmp/ links. Other URLs are not
// guaranteed permanent, so an owner should still review imported photos.
export function stablePhoto(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.pathname.split('/').includes('tmp');
  } catch { return false; }
}

export function mergeMissingPhotos(existing, additions, colours) {
  const merged = { ...(existing || {}) };
  let added = 0;
  for (const [colour, url] of Object.entries(additions || {})) {
    if (url && !merged[colour] && (!colours || colours.includes(colour))) {
      merged[colour] = url;
      added++;
    }
  }
  return { images: merged, added };
}

export function matchPrintfulProduct(printfulProducts, row) {
  const normal = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const exactId = (printfulProducts || []).filter((p) => p.externalId === row.id);
  const exactName = (printfulProducts || []).filter((p) => normal(p.name) && normal(p.name) === normal(row.name));
  const matches = exactId.length ? exactId : exactName;
  return matches.length === 1 ? matches[0] : null;
}

export function findMockupPhotos(printfulProducts, rows) {
  return (rows || []).map((row) => {
    const pf = matchPrintfulProduct(printfulProducts, row);
    const urls = new Map();
    for (const v of pf?.variants || []) {
      const colour = String(v.colour || '').trim();
      const url = v.preview;
      if (!colour || !stablePhoto(url)) continue;
      const colours = urls.get(url) || new Set();
      colours.add(colour);
      urls.set(url, colours);
    }
    const available = {};
    for (const v of pf?.variants || []) {
      const colour = String(v.colour || '').trim();
      const url = v.preview;
      if ((row.colors || []).includes(colour) && url && urls.get(url)?.size === 1 && !available[colour]) {
        available[colour] = url;
      }
    }
    const existing = row.images || {};
    const colours = (row.colors || []).map((name) => ({
      name,
      photo: existing[name] || null,
      source: existing[name] ? 'site' : available[name] ? 'printful' : null,
      available: available[name] || null,
    }));
    return {
      id: row.id, name: row.name, matched: Boolean(pf), colours,
      blankColours: colours.filter((c) => !c.photo).map((c) => c.name),
      importable: Object.fromEntries(Object.entries(available).filter(([colour]) => !existing[colour])),
    };
  });
}

// Match template to the catalog product and choose at most one size per colour.
// A template must be chosen explicitly by the owner: several templates can use
// the same blank while carrying completely different artwork.
export function templateVariants(row, product, template) {
  const allowed = new Set((template?.available_variant_ids || []).map(Number));
  const productId = Number(template?.product_id);
  if (!Number.isSafeInteger(productId) || productId <= 0 || !allowed.size) return {};
  const mapping = {};
  const idColours = new Map();
  for (const variant of product?.variants || []) {
    const id = Number(variant.variantId);
    const colour = String(variant.colour || '').trim();
    if (!Number.isSafeInteger(id) || id <= 0 || Number(variant.catalogProductId) !== productId || !allowed.has(id) || !(row.colors || []).includes(colour)) continue;
    const colours = idColours.get(id) || new Set();
    colours.add(colour);
    idColours.set(id, colours);
    if (!mapping[colour]) mapping[colour] = id;
  }
  for (const [colour, id] of Object.entries(mapping)) {
    if (idColours.get(id)?.size !== 1) delete mapping[colour];
  }
  return mapping;
}

// A task may return multiple placements. Use a front/chest result when available;
// the owner must review the resulting images before saving.
export function imagesForTask(task, colourVariants) {
  const output = {};
  for (const [colour, id] of Object.entries(colourVariants || {})) {
    const matches = (task.mockups || []).filter((m) => Array.isArray(m.variant_ids) && m.variant_ids.map(Number).includes(Number(id)) && typeof m.mockup_url === 'string');
    const rank = (m) => /back|rear|sleeve|label/i.test(String(m.placement || '')) ? 1 : 0;
    matches.sort((a,b) => rank(a) - rank(b));
    if (matches[0]) output[colour] = { url: matches[0].mockup_url, placement: matches[0].placement || '' };
  }
  // One URL shared across different colours is ambiguous and must not be
  // offered for either colour, even if Printful says it covers both variants.
  const seen = new Map();
  for (const [colour, image] of Object.entries(output)) {
    const colours = seen.get(image.url) || [];
    colours.push(colour);
    seen.set(image.url, colours);
  }
  for (const colours of seen.values()) if (colours.length > 1) {
    for (const colour of colours) delete output[colour];
  }
  return output;
}
