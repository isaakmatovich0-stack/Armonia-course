#!/usr/bin/env node
/**
 * Rebuild store/catalog.json's product list from what is actually on sale.
 *
 * WHY THIS EXISTS
 * ---------------
 * public/store/index.html is generated, and the product cards are baked into
 * it at build time from store/catalog.json. Replacing the catalogue in the
 * database therefore did not change the page: it kept painting the six
 * invented products ("The Signature Cap", $28) while the API served the six
 * real Printful ones ("Armonia Connect™ Hat | Embroidered", $23).
 *
 * The runtime patches prices onto ids that exist on the page, so the overlap
 * was zero — every product showed a price the shop would not charge. That is
 * the single most dangerous state this store can be in, and it is why this
 * script rewrites the file rather than patching around it.
 *
 * WHAT IT TOUCHES
 *   products     replaced, from the database
 *   colors       only the colours those products use
 *   featuredId   the cheapest garment with a photo (merchandising fallback)
 *   upsellId     the cheapest accessory with a photo
 *   site         cosmetic copy only — never prices or policies
 *   elements     element overrides pointing at deleted product ids dropped
 *
 * WHAT IT NEVER TOUCHES
 *   names and prices  — they are Printful's, verbatim, per the owner's brief
 *   theme, layout, brand, sections, order  — the design decisions
 *
 * Pricing note: `price` is the display fallback. The server re-prices every
 * bag and every checkout from store_products, so a wrong number here cannot
 * change what anybody is charged — it would only be a wrong-looking page.
 * Keep it equal to price_cents anyway: a mismatch is a bug waiting to confuse
 * whoever reads the file next.
 *
 * Usage
 *   node store/sync-catalog-file.mjs            rewrite the file
 *   node store/sync-catalog-file.mjs --dry-run  print what would change
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'store/catalog.json');

/* The storefront's own colour vocabulary. A product's colours are Printful's
 * names slugged ("burgundy-maroon"); the page needs a key it can map to a hex
 * and a label, and the featured card needs an initialColor that exists. */
const COLOUR_HEX = {
  black: '#1d1f20',
  'ink-black': '#283033',
  white: '#f4f2ec',
  ivory: '#eeece4',
  natural: '#e8e0cf',
  cream: '#efe9d8',
  navy: '#232f3e',
  'navy-blue': '#232f3e',
  'forest-green': '#2c3b2d',
  'burgundy-maroon': '#5a2430',
  maroon: '#5a2430',
  charcoal: '#3a3d3f',
  'heather-grey': '#b3b3b0',
  'sport-grey': '#a8a9a6',
  olive: '#5d6047',
  khaki: '#c3b091',
  sand: '#d9c9ac',
  'sky-blue': '#a9c8dc',
  sky: '#a9c8dc',
  red: '#8c2d0b',
  orange: '#8c2d0b',
};

const pretty = (key) =>
  String(key).replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/* Copy for the six products that exist. Keyed by database id, which is the
 * slug of the Printful name. Deliberately empty of adjectives that promise a
 * material Printful has not confirmed — "100% cotton twill" was invented for
 * the old cap and is not repeated for the hat. */
const COPY = {
  sticker: {
    category: 'Accessories',
    badge: 'DIE-CUT',
    subtitle: 'Weather-resistant vinyl sticker',
    description:
      'The emblem, as a sticker. Die-cut vinyl with a weather-resistant finish, sized to go on a laptop, a case or a guitar. Made and shipped by our print partner in the United States.',
    details: [
      'Die-cut vinyl with a weather-resistant finish',
      '4″ × 4″',
      'Made and fulfilled in the United States',
    ],
    fit: 'One size: 4″ × 4″. Sticks to most smooth, clean surfaces.',
  },
  'hat-embroidered': {
    category: 'Accessories',
    badge: 'EMBROIDERED',
    subtitle: 'Embroidered cap in three colours',
    description:
      'The everyday cap, with the Armonia Connect emblem embroidered at the front centre. Soft-structured, adjustable at the back, and quiet enough to wear with anything.',
    details: [
      'Embroidered Armonia Connect emblem',
      'Adjustable back strap • one size fits most',
      'Black, burgundy maroon or navy blue',
      'Embroidered and shipped by our print partner in the United States',
    ],
    fit: 'Adjustable. One size fits most.',
  },
  'beanie-embroidered': {
    category: 'Accessories',
    badge: 'EMBROIDERED',
    subtitle: 'Ribbed beanie with a small embroidered emblem',
    description:
      'A ribbed knit beanie with the emblem embroidered small at the front centre, so it reads as a detail rather than a logo. Warm without the bulk.',
    details: [
      'Small embroidered emblem, front centre',
      'Ribbed knit with a folded cuff',
      'Black, navy, olive or white',
      'Embroidered and shipped by our print partner in the United States',
    ],
    fit: 'One size. The folded cuff adjusts the fit.',
  },
  'windbreaker-embroidered': {
    category: 'Apparel',
    badge: 'WEATHERPROOF',
    subtitle: 'Lightweight windbreaker with an embroidered emblem',
    description:
      'A packable shell for the days that cannot decide. Water-resistant, light enough to fold into a bag, with the emblem embroidered at the chest.',
    details: [
      'Lightweight water-resistant shell',
      'Embroidered emblem at the chest',
      'Elastic cuffs and an adjustable hood',
      'Black or navy • S to 2XL',
    ],
    fit: 'True to size, with room for a light layer underneath. Size up to wear it over a hoodie.',
  },
  'unisex-classic-tee': {
    category: 'Apparel',
    badge: 'EVERYDAY',
    subtitle: 'Classic unisex tee',
    description:
      'The plain one, done properly. A classic unisex cut in maroon, black or navy, printed and shipped from the United States. The quiet half of the collection.',
    details: [
      'Classic unisex cut',
      'Maroon, black or navy',
      'S to 5XL',
      'Printed and shipped by our print partner in the United States',
    ],
    fit: 'A regular unisex fit. Choose your usual size, or size up for a looser shape.',
  },
  'hoodie-embroidered': {
    category: 'Apparel',
    badge: 'EMBROIDERED',
    subtitle: 'Embroidered hoodie in five colours',
    description:
      'The layer you reach for without thinking. A relaxed hoodie with the emblem embroidered at the chest, in five colours, with a kangaroo pocket and ribbed cuffs.',
    details: [
      'Embroidered Armonia Connect emblem',
      'Kangaroo pocket • ribbed cuffs and hem',
      'Black, navy, maroon, forest green or charcoal',
      'S to 5XL',
    ],
    fit: 'A relaxed unisex fit. Choose your regular size, or one up for extra room.',
  },
};

/* Image fallbacks for a product with no stored photo. These files are the
 * design mockups already in the repo and they match the blanks closely enough
 * to be honest: a black cap photo for a black cap. A product with no matching
 * type at all gets nothing, and the storefront shows its own "no photo"
 * placeholder rather than a picture of something else. */
const TYPE_FALLBACK = {
  cap: 'cap',
  beanie: 'cap',
  tee: 'tee',
  hoodie: 'hoodie',
  windbreaker: 'windbreaker',
  stickers: 'stickers',
  picks: 'picks',
};
/* Which of our image colours best stands in for a Printful colour. */
const PHOTO_COLOUR = {
  black: 'ink',
  navy: 'ink',
  'navy-blue': 'ink',
  charcoal: 'ink',
  'burgundy-maroon': 'orange',
  maroon: 'orange',
  'forest-green': 'ink',
  olive: 'ink',
  white: 'ivory',
  natural: 'ivory',
  cream: 'ivory',
};

function photoFor(type, colour, stored) {
  if (stored && stored[colour]) return stored[colour];
  const base = TYPE_FALLBACK[type];
  if (!base) return null;
  const shade = PHOTO_COLOUR[colour] || 'ink';
  const file = path.join(ROOT, 'public/store/images', `${base}-${shade}.webp`);
  if (fs.existsSync(file)) return `/store/images/${base}-${shade}.webp`;
  const back = path.join(ROOT, 'public/store/images', `windbreaker-front-${shade}.webp`);
  if (type === 'windbreaker' && fs.existsSync(back)) return `/store/images/windbreaker-front-${shade}.webp`;
  return null;
}


/*
 * Keep the build's PRODUCT_STATE block in step with the rows.
 *
 * The page needs two things the design file cannot know: the current price and
 * whether the product is on sale. Both live in the database and change without
 * a code change, so the block is generated here rather than remembered by hand.
 * A stale block is not a cosmetic problem — it is the page advertising a
 * product the server will refuse to sell.
 */
function writeProductState(products, rows) {
  const buildFile = path.join(ROOT, 'store/build-store.mjs');
  const source = fs.readFileSync(buildFile, 'utf8');
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const lines = products.map((p) => {
    const row = rowsById.get(p.id) || {};
    const price = Math.round(Number(row.price_cents) || Math.round(p.price * 100)) / 100;
    const inStock = row.in_stock !== false;
    // JSON.stringify on the key, because the ids contain hyphens ("hat-embroidered")
    // and an unquoted key there is a syntax error in the generated file.
    return `  ${JSON.stringify(p.id)}: { price: ${price}, inStock: ${inStock} },`;
  });
  const block = `const PRODUCT_STATE = {\n${lines.join('\n')}\n};`;
  const match = source.match(/const PRODUCT_STATE = \{[\s\S]*?\n\};/);
  if (!match) {
    throw new Error('store/build-store.mjs no longer has a PRODUCT_STATE block to update.');
  }
  if (match[0] === block) return;
  fs.writeFileSync(buildFile, source.replace(match[0], block));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // Where the rows come from:
  //   --from rows.json   a saved /api/admin/store-products response (or an
  //                      array of rows). This is how it runs without
  //                      credentials — the admin endpoint is behind the admin
  //                      login, so no service key has to travel.
  //   (nothing)          the database, using SUPABASE_* from the environment.
  const fromIndex = process.argv.indexOf('--from');
  const source = fromIndex !== -1 ? process.argv[fromIndex + 1] : null;

  let rows;
  if (source) {
    if (!fs.existsSync(source)) {
      console.error(`  ${source} does not exist`);
      process.exit(1);
    }
    const parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
    rows = Array.isArray(parsed) ? parsed : parsed.products;
    if (!Array.isArray(rows)) {
      console.error('  that file has no product rows in it');
      process.exit(1);
    }
    console.log(`  reading rows from ${path.basename(source)}`);
  } else {
    const { listProducts } = await import('../lib/store/db.js');
    rows = await listProducts();
  }
  if (!rows || !rows.length) {
    console.error('  no products to read — run the Printful replacement first');
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const before = new Set((catalog.products || []).map((p) => p.id));

  // ── colours: only the ones these products use ────────────────────────────
  const colors = {};
  for (const row of rows) {
    for (const key of row.colors || []) {
      if (colors[key]) continue;
      colors[key] = { name: pretty(key), hex: COLOUR_HEX[key] || '#cdc8bd' };
    }
  }

  // ── products ─────────────────────────────────────────────────────────────
  const products = rows.map((row) => {
    const copy = COPY[row.id] || {};
    const colourKeys = Array.isArray(row.colors) ? row.colors : [];
    const images = {};
    for (const key of colourKeys) {
      const shot = photoFor(row.type, key, row.images);
      if (shot) images[key] = shot;
    }
    const backImages = {};
    for (const key of colourKeys) {
      const stored = (row.back_images || {})[key];
      if (stored) backImages[key] = stored;
    }
    const product = {
      id: row.id,
      // Printful's name, verbatim — but trimmed. Two of the six come back with
      // a trailing space, which renders as a ragged gap in the product grid.
      // Trimming whitespace is not a renaming; the words are untouched.
      name: String(row.name || '').trim(),
      shortName: String(row.short_name || row.name || '').trim(),
      price: Math.round(Number(row.price_cents) || 0) / 100,
      category: copy.category || row.category || 'Apparel',
      type: row.type,
      initialColor: colourKeys[0] || 'ink',
      badge: copy.badge || row.badge || '',
      subtitle: copy.subtitle || row.subtitle || '',
      description: copy.description || row.description || '',
      details: copy.details || (Array.isArray(row.details) ? row.details : []),
      fit: copy.fit || row.fit || '',
      colors: colourKeys,
      sizes: Array.isArray(row.sizes) ? row.sizes : [],
      images,
    };
    if (Object.keys(backImages).length) product.backImages = backImages;
    return product;
  });

  // ── merchandising pointers ───────────────────────────────────────────────
  // The hero is the most persuasive slot on the page, so it goes to a garment
  // that has a photograph. An accessory with a photo becomes the upsell.
  const scored = products.map((p) => ({ p, hasPhoto: Object.keys(p.images).length > 0 }));
  const garments = ['hoodie', 'windbreaker', 'tee', 'cap', 'beanie'];
  const featured =
    scored.find((s) => s.hasPhoto && garments.includes(s.p.type)) ||
    scored.find((s) => s.hasPhoto) ||
    scored[0];
  const upsell = scored.find((s) => s.hasPhoto && s.p.id !== featured.p.id && !garments.includes(s.p.type));

  // ── site copy: cosmetic only ─────────────────────────────────────────────
  const types = [...new Set(products.map((p) => p.type))];
  const nouns = {
    cap: 'caps', beanie: 'beanies', tee: 'tees', hoodie: 'hoodies',
    windbreaker: 'windbreakers', stickers: 'stickers', picks: 'picks',
  };
  // Garments first, accessories last, so the sentence leads with what people
  // actually came for. Capitalised because it starts a sentence.
  const order = ['hoodie', 'windbreaker', 'tee', 'cap', 'beanie', 'picks', 'stickers'];
  const list = types
    .slice()
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((t) => nouns[t] || t);
  const joined = `${list.slice(0, -1).join(', ')}${list.length > 1 ? ' and ' + list.at(-1) : (list[0] || 'goods')}`;
  const description =
    `Wear your connection. ${joined.charAt(0).toUpperCase()}${joined.slice(1)}` +
    ' from the Armonia Connect collection, embroidered and printed in the United States.' +
    ' $6 flat US shipping, free over $75.';

  // ── element overrides that name a dead product ───────────────────────────
  // The Studio export carries per-element tweaks keyed by CSS selector. A
  // selector containing a product id dies with that product, and a stale
  // override is invisible until it hides the wrong thing.
  const elements = {};
  let droppedElements = 0;
  for (const [selector, rule] of Object.entries(catalog.elements || {})) {
    const named = [...before].find((id) => selector.includes(id));
    if (named && !products.some((p) => p.id === named)) { droppedElements += 1; continue; }
    elements[selector] = rule;
  }

  const next = {
    ...catalog,
    site: { ...catalog.site, description },
    products,
    colors,
    featuredId: featured.p.id,
    upsellId: upsell ? upsell.p.id : null,
    elements,
  };
  // The old season flag belonged to the built page. The switch is in the
  // database now, so leaving a `fallFlares` in the file would be a second
  // source of truth for the same question.
  delete next.site.fallFlares;

  const removed = [...before].filter((id) => !products.some((p) => p.id === id));
  const added = products.filter((p) => !before.has(p.id)).map((p) => p.id);

  console.log(`  products      ${before.size} → ${products.length}`);
  if (added.length) console.log(`  added         ${added.join(', ')}`);
  if (removed.length) console.log(`  removed       ${removed.join(', ')}`);
  console.log(`  featured      ${next.featuredId} ${featured.hasPhoto ? '(has a photo)' : '(NO PHOTO)'}`);
  console.log(`  upsell        ${next.upsellId || 'none'}`);
  console.log(`  colours       ${Object.keys(colors).join(', ')}`);
  console.log(`  elements      ${droppedElements} stale override(s) dropped`);
  for (const p of products) {
    const shots = Object.keys(p.images).length;
    console.log(
      `    ${p.id.padEnd(24)} $${p.price.toFixed(2).padStart(6)}  ${p.type.padEnd(11)} ` +
      `${p.colors.length} colour(s), ${p.sizes.length} size(s), ${shots} photo(s)` +
      (shots ? '' : '   ← no photo, storefront shows the placeholder'),
    );
  }

  if (dryRun) {
    console.log('\n  --dry-run: store/catalog.json not written');
    return;
  }
  fs.writeFileSync(CATALOG, `${JSON.stringify(next, null, 2)}\n`);
  writeProductState(products, rows);
  console.log('\n  wrote store/catalog.json and the PRODUCT_STATE block in store/build-store.mjs');
  console.log('  run `npm run build:store` to rebuild the page');
}

main().catch((err) => {
  console.error(`\n  failed: ${err.message}\n`);
  process.exit(1);
});
