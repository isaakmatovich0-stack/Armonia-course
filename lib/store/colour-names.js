// The only place a product colour is named.
//
// WHY THIS FILE EXISTS
// --------------------
// Colours used to live in two places that drifted:
//
//   lib/store/sync.js  translated Printful's names into a design-brief
//                      vocabulary — Black became "ink", White became
//                      "ivory", anything blue became "sky", Red became
//                      "orange". That palette was the autumn theme, which
//                      is gone, so the translation now only corrupts data.
//
//   store/catalog.json listed lowercase slugs — "black", "navy-blue" — while
//                      an order stores the colour *name* ("Black"). The
//                      variant mapper wrote "hat|black|ONE SIZE" and every
//                      real order looked up "hat|Black|ONE SIZE". Nothing
//                      ever matched, so no order could reach Printful.
//
// The fix is to stop translating. A colour is exactly what Printful calls it,
// and that one string is the key, the label, the order line and the filename.
//
// WHY THIS MATTERS FOR FULFILMENT
// ------------------------------
// `lib/store/catalog.js` sets `colorName` from `colors[key].name`, and
// `itemsForMetadata` stores `colorName` on the order. `fulfilment.js` then
// builds `${productId}|${item.color}|${item.size}`. So the *name* is the join
// key between what the shopper saw and what Printful must print. Making the
// key and the name the same string is what makes that join correct.

/**
 * Exact Printful colour names.
 *
 * `hex` is the swatch the storefront paints. It is a real colour sampled from
 * our own product photography where we have a photo of that blank, and
 * Printful's published sample otherwise — never an invented shade, because a
 * swatch that lies about a colour is worse than one that admits it is a guess.
 *
 * `slug` is the filename stem: /store/images/<type>-<slug>.webp. Deriving it
 * from the name rather than writing it by hand is what stops a photo of a rust
 * cap being attached to the colour "Burgundy Maroon".
 */
export const PRINTFUL_COLOURS = {
  White: { hex: '#e8e6e0', slug: 'white' },
  Black: { hex: '#212729', slug: 'black' },
  'Navy Blue': { hex: '#232f3e', slug: 'navy-blue' },
  Navy: { hex: '#232f3e', slug: 'navy' },
  'Burgundy Maroon': { hex: '#5a2430', slug: 'burgundy-maroon' },
  Maroon: { hex: '#5a2430', slug: 'maroon' },
  'Forest Green': { hex: '#2c3b2d', slug: 'forest-green' },
  Charcoal: { hex: '#3a3d3f', slug: 'charcoal' },
  Olive: { hex: '#5d6047', slug: 'olive' },
  'Sky Blue': { hex: '#a9c8dc', slug: 'sky-blue' },
  Natural: { hex: '#e6e1d3', slug: 'natural' },
  'Heather Grey': { hex: '#b9bcbb', slug: 'heather-grey' },
};

/** Every colour name we will accept, for gates and for the sync's warnings. */
export const PRINTFUL_COLOUR_NAMES = Object.keys(PRINTFUL_COLOURS);

/** Filename stem for a colour name; falls back to a slug of the raw name. */
export function slugForColour(name) {
  const known = PRINTFUL_COLOURS[name];
  if (known) return known.slug;
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The swatch for a colour name, or null when we have never seen it. */
export function hexForColour(name) {
  const known = PRINTFUL_COLOURS[name];
  return known ? known.hex : null;
}

/**
 * Resolve a name Printful sent into our canonical spelling.
 *
 * Printful is not perfectly consistent — "Navy Blue" on one blank and "Navy"
 * on another, "Burgundy Maroon" and "Maroon" — and the owner's instruction was
 * to keep both rows rather than merge them, so exact matches are tried first
 * and case-insensitive matches second. An unrecognised colour comes back as
 * `known: false` so the caller can report it instead of inventing a swatch.
 */
export function resolveColourName(printfulColour) {
  const raw = String(printfulColour || '').trim();
  if (!raw) return null;
  if (PRINTFUL_COLOURS[raw]) return { name: raw, ...PRINTFUL_COLOURS[raw], known: true };

  // Case-insensitive ("navy blue" → "Navy Blue").
  const lower = raw.toLowerCase();
  const byCase = PRINTFUL_COLOUR_NAMES.find((name) => name.toLowerCase() === lower);
  if (byCase) return { name: byCase, ...PRINTFUL_COLOURS[byCase], known: true };

  // Slug form. The database still holds the old admin's lowercase hyphenated
  // keys — "navy-blue", "burgundy-maroon", "forest-green" — while the
  // storefront builds its picker from the catalogue file, which says
  // "Navy Blue". Without this the two disagree and add-to-bag answers "That
  // colour is not available" for a colour the shop is plainly showing.
  const rawSlug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const bySlug = PRINTFUL_COLOUR_NAMES.find((name) => PRINTFUL_COLOURS[name].slug === rawSlug);
  if (bySlug) return { name: bySlug, ...PRINTFUL_COLOURS[bySlug], known: true };

  return { name: raw, hex: null, slug: slugForColour(raw), known: false };
}
