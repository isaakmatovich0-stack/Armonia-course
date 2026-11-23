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

// Colours are Printful's names, exactly. There is no translation table any
// more: one used to map "Black" to "ink" and "Red" to "orange" (the autumn
// theme's vocabulary), which meant a synced product came back with colours the
// storefront did not sell and an order key that could never match. The naming
// rules now live in lib/store/colour-names.js and nowhere else.
import { resolveColourName } from './colour-names.js';

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
 * Returns `{ name, hex, slug, known }` — the name IS the storefront key, so
 * what the shopper picks and what the order carries are the same string.
 * `hex` is null when the colour is one we have never seen; the caller reports
 * that rather than inventing a swatch.
 */
export function colourFor(printfulColour) {
  return resolveColourName(printfulColour);
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
    const colourSet = new Map();   // colour name -> { name, hex, printfulNames[] }
    const sizes = new Set();
    let minPrice = null;

    const images = {};        // colour name -> product photo for that colour
    // How many DISTINCT preview URLs Printful gave us. One photo repeated for
    // every colour means we do not actually have a photo per colour, and
    // writing it under each name would show a black cap captioned "Navy Blue" —
    // the exact bug this file was rewritten to stop. So: only publish a colour's
    // photo when it is its own picture.
    const previewsByColour = new Map();
    for (const v of variants) {
      const shot = v.preview || (Array.isArray(v.previews) ? v.previews[0] : null) || v.thumbnail || null;
      if (!shot) continue;
      const bucket = previewsByColour.get(shot) || new Set();
      bucket.add(String(v.colour || '').trim());
      previewsByColour.set(shot, bucket);
    }
    const reusedUrls = [...previewsByColour.keys()].filter((url) => previewsByColour.get(url).size > 1);

    // productId|colour|size -> Printful's sync_variant_id.
    //
    // Without this map an order cannot be placed at all: buildOrderPayload
    // reports every line as `missing` and Printful is never asked to ship. It
    // is read straight off the sync, because the ids are already in hand — the
    // only reason it was ever a manual step is that nobody had derived it here.
    // Deriving it does not change what a shopper buys; it only makes the
    // garment we already sell addressable by the supplier.
    const variantMap = {};

    for (const v of variants) {
      const def = colourFor(v.colour);
      if (!def) continue;
      if (v.syncVariantId) {
        // A product with no sizes gets "*" so one id serves its only option,
        // which is how the sticker and the picks are keyed.
        const size = String(v.size || '').trim() || '*';
        variantMap[`${match ? match.id : slug(pf.name)}|${def.name}|${size}`] = String(v.syncVariantId);
      }

      // First mockup wins per colour. Printful returns one per size, so every
      // size of "Black" carries the same picture — taking the first keeps the
      // storefront from flickering between sizes in a colour swatch.
      // Keyed by the colour NAME, because that is what `colours` below is keyed
      // by and what an order line carries. This used to be `def.slug`, so a
      // sync wrote { "navy-blue": <mockup> } while the product's colours were
      // ["Navy Blue"] — nothing ever matched, the mockup was dropped on the
      // floor, and the storefront fell back to a placeholder. That is the
      // "mockups are not the same as Printful" bug: we were fetching the right
      // pictures and then filing them under a name the page never asked for.
      if (!images[def.name]) {
        const shot = v.preview || (Array.isArray(v.previews) ? v.previews[0] : null) || v.thumbnail || null;
        if (shot && !reusedUrls.includes(shot)) images[def.name] = shot;
      }
      // Keyed by Printful's name: the storefront key and the order's
      // colorName are then the same string, which is what makes the
      // productId|colour|size variant lookup match.
      colours[def.name] = colours[def.name] || { name: def.name, hex: def.hex };
      if (!def.known) {
        warnings.push({
          kind: 'unknown-colour',
          product: pf.name,
          colour: def.name,
          message: `Printful's "${def.name}" has no swatch colour yet. Add it to PRINTFUL_COLOURS in lib/store/colour-names.js, or it shows as a blank swatch.`,
        });
      }
      const entry = colourSet.get(def.name) || { key: def.name, slug: def.slug, printfulNames: [] };
      entry.printfulNames.push(v.colour);
      colourSet.set(def.name, entry);

      if (v.size) sizes.add(v.size.toUpperCase());
      const price = Number(v.price);
      if (Number.isFinite(price) && price > 0) {
        minPrice = minPrice === null ? price : Math.min(minPrice, price);
      }
    }

    if (!Object.keys(images).length && variants.length) {
      warnings.push({
        kind: 'no-mockup',
        product: pf.name,
        message:
          `Printful has no garment mockup for "${pf.name}" yet, so its cards would show a placeholder. ` +
          'Open the product in Printful and generate a mockup for each colour — until then the shop shows no photo rather than the flat artwork file.',
      });
    }

    if (reusedUrls.length) {
      warnings.push({
        kind: 'shared-preview',
        product: pf.name,
        message:
          `Printful gave the same mockup for ${[...previewsByColour.get(reusedUrls[0])].join(', ')} on "${pf.name}", ` +
          'so those colours are left without a photo rather than all showing one colour. ' +
          'Upload a photo per colour under Products & Prices, or create a per-colour mockup in Printful.',
      });
    }

    // Insertion order, not an alphabetical or hand-written ranking: that is
    // the order Printful lists the blanks in, which reads as the real range.
    const proposedColours = [...colourSet.keys()];

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
      // Colour key -> mockup URL, keyed by colour name so it lines up with
      // `colors` and with an order line.
      images,
      // Empty when Printful returned no variant ids, which the admin reports
      // rather than saving a map that would fail on the first real order.
      supplierVariants: variantMap,
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
      const currentImages = (match.images && typeof match.images === 'object') ? match.images : {};
      const imageAdds = Object.keys(images).filter((k) => images[k] && !currentImages[k]);
      if (imageAdds.length) {
        changes.images = {
          from: Object.keys(currentImages).length,
          to: imageAdds,
          note: `${imageAdds.length} empty colour photo slot(s) would be filled from Printful. Existing photos are preserved.`,
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
