// Rebuilding our catalogue from what is actually in the Printful store.
//
// The store was built from a design brief: four colours, five sizes, five
// products. The Printful store is built from what the blanks actually come in.
// Those two lists drift the moment real products exist, and a colour we sell
// that Printful does not make is an order that cannot be fulfilled.
//
// So this module plans the change rather than performing it. `buildSyncPlan`
// is pure — no network, no database — which means the dangerous part (deciding
// what to overwrite) can be tested without either.

const COLOUR_ORDER = ['sky', 'ink', 'ivory', 'orange'];

// Unknown colours sort last, in the order Printful listed them, so a new
// Heather Grey joins the end of the swatch row rather than jumping to the front.
const colourRank = (key) => {
  const i = COLOUR_ORDER.indexOf(key);
  return i === -1 ? COLOUR_ORDER.length + 100 : i;
};

// Printful names blanks by colour; we name them by mood. This is the bridge,
// and it is deliberately small and explicit: guessing an unknown colour's hex
// would put a wrong-looking swatch on the storefront.
const COLOUR_HINTS = {
  black: { key: 'ink', name: 'Ink black', hex: '#283033' },
  'ink black': { key: 'ink', name: 'Ink black', hex: '#283033' },
  white: { key: 'ivory', name: 'Cloud white', hex: '#eeece4' },
  natural: { key: 'ivory', name: 'Cloud white', hex: '#eeece4' },
  'natural raw': { key: 'ivory', name: 'Cloud white', hex: '#eeece4' },
  cream: { key: 'ivory', name: 'Cloud white', hex: '#eeece4' },
  'heather dust': { key: 'ivory', name: 'Cloud white', hex: '#eeece4' },
  'sky blue': { key: 'sky', name: 'Founders Limited', hex: '#a9c8dc' },
  sky: { key: 'sky', name: 'Founders Limited', hex: '#a9c8dc' },
  blue: { key: 'sky', name: 'Founders Limited', hex: '#a9c8dc' },
  'light blue': { key: 'sky', name: 'Founders Limited', hex: '#a9c8dc' },
  red: { key: 'orange', name: 'Autumn Orange', hex: '#8c2d0b' },
  orange: { key: 'orange', name: 'Autumn Orange', hex: '#8c2d0b' },
  'burnt orange': { key: 'orange', name: 'Autumn Orange', hex: '#8c2d0b' },
  rust: { key: 'orange', name: 'Autumn Orange', hex: '#8c2d0b' },
};

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'OS', 'ONE SIZE'];

const slug = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function sizeRank(size) {
  const i = SIZE_ORDER.indexOf(String(size || '').toUpperCase());
  return i === -1 ? SIZE_ORDER.length + 1 : i;
}

/**
 * Turn a Printful colour name into a colour definition for our storefront.
 *
 * Returns `null` when there is no confident mapping, and the caller reports it
 * rather than inventing a swatch. A storefront that lies about a colour is
 * worse than one that admits it does not know yet.
 */
export function colourFor(printfulColour) {
  const key = String(printfulColour || '').toLowerCase().trim();
  if (!key) return null;
  const exact = COLOUR_HINTS[key];
  if (exact) return { ...exact, known: true };

  // Fall back to asking the human: a stable key and the real name, no hex.
  return {
    key: slug(printfulColour),
    name: String(printfulColour).trim(),
    hex: null,
    known: false,
  };
}

/**
 * Plan the rebuild.
 *
 * @param printfulProducts  from printful.listSyncProducts()
 * @param ourRows           rows from db.listProducts()
 * @param currentColours    the store's colour map, { key: { name, hex } }
 */
export function buildSyncPlan(printfulProducts, ourRows, currentColours = {}) {
  const rows = ourRows || [];
  const colours = { ...(currentColours || {}) };

  const warnings = [];
  const products = [];

  for (const pf of printfulProducts || []) {
    const variants = pf.variants || [];
    if (!variants.length) {
      warnings.push({
        kind: 'no-variants',
        product: pf.name,
        message: `"${pf.name}" has no variants in Printful, so there is nothing to sell yet.`,
      });
      continue;
    }

    // Which of our products is this? An external_id is explicit; a name match
    // is a guess, so it is recorded as such and shown to the human.
    let match = null;
    let confidence = null;
    const byExternal = rows.find((r) => r.id === pf.externalId);
    if (byExternal) {
      match = byExternal;
      confidence = 'id';
    } else {
      const byName = rows.find((r) => {
        const a = norm(r.name), b = norm(pf.name);
        return a && b && (a.includes(b) || b.includes(a));
      });
      if (byName) {
        match = byName;
        confidence = 'name';
      }
    }

    // Colours and sizes, in the order a person expects to see them.
    const colourSet = new Map();   // our key -> { name, hex, printfulNames[] }
    const sizes = new Set();
    let minPrice = null;

    for (const v of variants) {
      const def = colourFor(v.colour);
      if (!def) continue;
      colours[def.key] = colours[def.key] || { name: def.name, hex: def.hex };
      if (!def.known) {
        warnings.push({
          kind: 'unknown-colour',
          product: pf.name,
          colour: def.name,
          message: `Printful's "${def.name}" has no swatch colour yet. Set a hex for "${def.key}" or the storefront will show it as blank.`,
        });
      }
      const entry = colourSet.get(def.key) || { key: def.key, printfulNames: [] };
      entry.printfulNames.push(v.colour);
      colourSet.set(def.key, entry);

      if (v.size) sizes.add(v.size.toUpperCase());
      const price = Number(v.price);
      if (Number.isFinite(price) && price > 0) {
        minPrice = minPrice === null ? price : Math.min(minPrice, price);
      }
    }

    const proposedColours = [...colourSet.keys()].sort((a, b) => colourRank(a) - colourRank(b));

    // Caps, beanies and stickers have no sizes: Printful returns an empty size
    // for them. Collapsing those to [] would tell the storefront a product has
    // zero sizes, and the size picker divides by that. Keep the existing
    // single-size value, or default to OS.
    let proposedSizes = [...sizes].sort((a, b) => sizeRank(a) - sizeRank(b));
    if (!proposedSizes.length) {
      const existing = match && Array.isArray(match.sizes) && match.sizes.length === 1 ? match.sizes : null;
      proposedSizes = existing || ['OS'];
    }

    const next = {
      id: match ? match.id : slug(pf.name),
      name: match ? match.name : pf.name,
      printfulName: pf.name,
      printfulId: pf.id,
      confidence: confidence || 'new',
      colors: proposedColours,
      sizes: proposedSizes,
      priceCents: minPrice === null ? null : Math.round(minPrice * 100),
      image: pf.thumbnail || null,
      variantCount: variants.length,
    };

    const changes = {};
    if (match) {
      const currentColoursList = Array.isArray(match.colors) ? match.colors : [];
      const currentSizes = Array.isArray(match.sizes) ? match.sizes : [];
      if (proposedColours.join(',') !== currentColoursList.join(',')) {
        changes.colors = { from: currentColoursList, to: proposedColours };
      }
      if (proposedSizes.join(',') !== currentSizes.join(',')) {
        changes.sizes = { from: currentSizes, to: proposedSizes };
      }
      // Price is never changed silently. Ours is a business decision; Printful's
      // is a cost. They are shown side by side and left alone.
      const removedColours = currentColoursList.filter((c) => !proposedColours.includes(c));
      const removedSizes = currentSizes.filter((c) => !proposedSizes.includes(c));
      if (removedColours.length || removedSizes.length) {
        warnings.push({
          kind: 'removed-options',
          product: match.name,
          message:
            `"${match.name}" would stop selling ` +
            [
              removedColours.length ? `the colour(s) ${removedColours.join(', ')}` : '',
              removedSizes.length ? `the size(s) ${removedSizes.join(', ')}` : '',
            ].filter(Boolean).join(' and ') +
            `. Printful has no variant for them, so they cannot be fulfilled — but anyone mid-checkout will find them gone.`,
          removedColours,
          removedSizes,
        });
      }
      if (next.priceCents && Number(match.price_cents) !== next.priceCents) {
        changes.priceNote = {
          ours: match.price_cents ?? null,
          printfulRetail: next.priceCents,
        };
      }
      if (!match.supplier) changes.supplier = { from: match.supplier || null, to: 'printful' };
    }

    products.push({ ...next, changes, isNew: !match });
  }

  // Products we sell that Printful does not make. This is the dangerous case:
  // they are still purchasable and can never be fulfilled.
  const matchedIds = new Set(products.filter((p) => !p.isNew).map((p) => p.id));
  const orphans = rows
    .filter((r) => r.in_stock !== false && !matchedIds.has(r.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      message: `"${r.name}" is on sale but not in your Printful store, so it cannot be fulfilled. Create it in Printful, or stop selling it.`,
    }));

  return {
    products,
    colours,
    warnings,
    orphans,
    summary: {
      matched: products.filter((p) => !p.isNew).length,
      added: products.filter((p) => p.isNew).length,
      changed: products.filter((p) => !p.isNew && Object.keys(p.changes).length).length,
      orphans: orphans.length,
      unknownColours: warnings.filter((w) => w.kind === 'unknown-colour').length,
      removedOptions: warnings.filter((w) => w.kind === 'removed-options').length,
    },
  };
}
