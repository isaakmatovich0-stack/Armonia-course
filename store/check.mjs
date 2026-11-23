#!/usr/bin/env node
/**
 * Pre-deploy sanity check — `npm run check`
 * ---------------------------------------------------------------------------
 * Parses every source file this project actually deploys. Cheap, no
 * dependencies, and it catches the one class of mistake that Vercel would only
 * surface as a 500 at runtime: a syntax error in a serverless function.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveColourName } from '../lib/store/colour-names.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const MODULES = [
  'api/[...slug].js',
  'api/admin/[...slug].js',
  'api/store/[...slug].js',
  'api/checkout.js',
  'api/webhook.js',
  'lib/supabase.js',
  'lib/email.js',
  'lib/store/catalog.js',
  'lib/store/cart.js',
  'lib/store/db.js',
  'lib/store/orders.js',
  'store/build-store.mjs',
  'store/pages/shell.mjs',
  'store/runtime.js',
  'dev-server.mjs',
];

let failures = 0;

for (const relative of MODULES) {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) {
    console.log(`  ✗ ${relative} — missing`);
    failures += 1;
    continue;
  }
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`  ✓ ${relative}`);
  } catch (err) {
    failures += 1;
    console.log(`  ✗ ${relative}\n${String(err.stderr || err.message).split('\n').slice(0, 4).join('\n')}`);
  }
}

/* ── colours must be Printful's names, with real swatches ───────────────────
   Two bugs lived here and both reached a shopper:
     • colours were lowercase slugs ("burgundy-maroon") while an order stores
       the colour NAME ("Burgundy Maroon"), so the variant map could never
       match — every paid order would ship nothing.
     • a colour missing from the hex table got "#cdc8bd", a grey swatch, so
       three real colours rendered as the same grey blob.
   Neither is visible in a build log, so check the data. */
{
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'store/catalog.json'), 'utf8'));
  const problems = [];
  for (const product of catalog.products || []) {
    for (const colour of product.colors || []) {
      const def = (catalog.colors || {})[colour];
      if (!def) {
        problems.push(`${product.id}: colour "${colour}" has no entry in colors`);
        continue;
      }
      // The key, the label and the order line must be one string. If the label
      // differs from the key, fulfilment's `productId|color|size` lookup is
      // built from a different value than the mapper wrote.
      if (def.name !== colour) {
        problems.push(`${product.id}: colour key "${colour}" is named "${def.name}" — they must be identical`);
      }
      if (!/^#[0-9a-f]{6}$/i.test(String(def.hex || ''))) {
        problems.push(`${product.id}: "${colour}" has no usable swatch (${def.hex})`);
      }
      if (String(def.hex).toLowerCase() === '#cdc8bd') {
        problems.push(`${product.id}: "${colour}" is using the grey "unknown colour" swatch`);
      }
    }
    // Every photo must be keyed by a colour the product actually sells, and
    // must exist on disk. A key that sells nothing is dead weight; a path that
    // 404s is a broken image in the shop.
    for (const [colour, file] of Object.entries(product.images || {})) {
      if (!(product.colors || []).includes(colour)) {
        problems.push(`${product.id}: photo keyed to "${colour}", which it does not sell`);
      }
      const rel = String(file).replace(/^\/store\//, 'public/store/');
      if (!fs.existsSync(path.join(ROOT, rel))) {
        problems.push(`${product.id}: photo missing on disk — ${file}`);
      }
    }
  }
  if (problems.length) {
    failures += problems.length;
    console.log('  ✗ colour data is inconsistent:');
    for (const line of problems.slice(0, 12)) console.log(`      ${line}`);
    if (problems.length > 12) console.log(`      …and ${problems.length - 12} more`);
  } else {
    const colourCount = Object.keys(catalog.colors || {}).length;
    const photoCount = (catalog.products || []).reduce(
      (sum, p) => sum + Object.keys(p.images || {}).length, 0);
    console.log(`  ✓ ${colourCount} colours, all named as Printful names them, all with real swatches`);
    console.log(`  ✓ ${photoCount} product photos, every one present on disk and keyed to a real colour`);
  }
}

/* ── the festive layer must actually be able to draw ───────────────────────
   "Not festive enough" was partly a styling argument and partly a bug: the
   rules for the garland, lights and hero wash were generated on a code path a
   normal build never runs (`extractExport`), so they silently never reached the
   browser. Assert that the emitted stylesheet contains the pieces the runtime
   creates, or the season renders as bare snowflakes again. */
{
  const css = fs.readFileSync(path.join(ROOT, 'public/store/base.css'), 'utf8');
  const required = [
    ['the falling-snow layer', '.armonia-decoration-layer'],
    ['the snowflake rule', '.armonia-flake'],
    ['the treeline', '.armonia-tree'],
    ['the garland', '.armonia-garland'],
    ['the string of lights', '.armonia-lights'],
    ['the corner flakes', '.armonia-corner'],
    ['the hero season wash', 'has-decorations .hero::after'],
    ['Printful photo blending', 'data-photo-live'],
  ];
  const missing = required.filter(([, needle]) => !css.includes(needle));
  const runtime = fs.readFileSync(path.join(ROOT, 'store/runtime.js'), 'utf8');
  const runtimeParts = ['garlandSvg', 'lightsRow', 'armonia-corner', 'decorationFlakes'];
  const missingRuntime = runtimeParts.filter((part) => !runtime.includes(part));
  if (missing.length || missingRuntime.length) {
    failures += missing.length + missingRuntime.length;
    console.log('  ✗ the festive layer is incomplete:');
    for (const [label] of missing) console.log(`      missing CSS for ${label}`);
    for (const part of missingRuntime) console.log(`      runtime never builds ${part}()`);
  } else {
    console.log(`  ✓ festive layer complete (snow, ${required.length - 1} pieces, and photo blending)`);
  }
}

/* ── the page's layout must still be a list of SECTIONS ─────────────────────
   `catalog.order` is the section order the bundle renders: hero, marquee,
   collection, story, promises, newsletter. While reordering the products I
   assigned that key a list of product ids, and the storefront rendered nothing
   at all — an empty page between the hero and the footer, with no error in any
   log. The render check caught it; this names the cause when it happens. */
{
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'store/catalog.json'), 'utf8'));
  const layout = catalog.order;
  const ids = new Set((catalog.products || []).map((p) => p.id));
  const problems = [];
  if (!Array.isArray(layout) || !layout.length) {
    problems.push('order is missing or empty — the page would render no sections');
  } else {
    const asProducts = layout.filter((entry) => ids.has(entry));
    if (asProducts.length) {
      problems.push(`order contains product ids (${asProducts.join(', ')}) — it must list sections like "collection"`);
    }
    for (const section of ['hero', 'collection']) {
      if (!layout.includes(section)) problems.push(`order is missing the "${section}" section`);
    }
  }
  if (problems.length) {
    failures += problems.length;
    console.log('  ✗ catalogue layout order is wrong:');
    for (const line of problems) console.log(`      ${line}`);
  } else {
    console.log(`  ✓ page layout order intact (${layout.join(' → ')})`);
  }
}

/* ── legacy DB colour keys must still resolve ───────────────────────────────
   The database kept the old admin's lowercase hyphenated colour keys while the
   page was rebuilt with Printful's names. Both have to mean the same colour or
   the bag endpoint refuses a colour the shop is showing — "That colour is not
   available" on a card you can see. resolveColourName is the bridge, so prove
   the bridge carries every spelling the database has ever used. */
{
  const legacy = [
    ['black', 'Black'],
    ['white', 'White'],
    ['navy', 'Navy'],
    ['navy-blue', 'Navy Blue'],
    ['burgundy-maroon', 'Burgundy Maroon'],
    ['maroon', 'Maroon'],
    ['forest-green', 'Forest Green'],
    ['charcoal', 'Charcoal'],
    ['olive', 'Olive'],
  ];
  const broken = legacy.filter(([key, expected]) => {
    const got = resolveColourName(key);
    return !got || got.name !== expected || !got.hex;
  });
  if (broken.length) {
    failures += broken.length;
    console.log('  ✗ legacy colour keys no longer resolve to Printful names:');
    for (const [key, expected] of broken) {
      const got = resolveColourName(key);
      console.log(`      "${key}" should be "${expected}", got ${JSON.stringify(got && got.name)}`);
    }
  } else {
    console.log(`  ✓ all ${legacy.length} legacy colour spellings still map to Printful names`);
  }
}

/* ── the generated bundle must PARSE ───────────────────────────────────────
   This is the bug that took the storefront down: a build patch left a dangling
   `const _unused=[` inside the leaf component, `npm run check` said All good,
   Vercel said pass, and the live page was blank because the whole bundle threw
   a SyntaxError before React could mount.

   `store/build-store.mjs` is in MODULES above, so its own source was checked —
   but the file it *emits* was not, and that is the one browsers execute. An
   unchecked generated artefact is the worst of both worlds: it looks verified.
   Running `node --check` on it is the cheapest possible guard. */
for (const relative of ['public/store/frontend.js', 'public/store/live.js']) {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) {
    failures += 1;
    console.log(`  ✗ ${relative} — missing (run npm run build:store)`);
    continue;
  }
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`  ✓ ${relative} parses (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
  } catch (err) {
    failures += 1;
    const line = String(err.stderr || err.message).split('\n').find((l) => /Error/.test(l)) || '';
    console.log(`  ✗ ${relative} DOES NOT PARSE — the storefront would be a blank page`);
    if (line) console.log(`    ${line.trim()}`);
    console.log('    fix the PATCHES in store/build-store.mjs, then npm run build:store');
  }
}

/* Inline scripts inside the admin panel are easy to break with a stray quote. */
const adminHtml = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
const blocks = [...adminHtml.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
blocks.forEach((code, index) => {
  try {
    new Function(code);
    console.log(`  ✓ public/admin/index.html inline script #${index + 1}`);
  } catch (err) {
    failures += 1;
    console.log(`  ✗ public/admin/index.html inline script #${index + 1}: ${err.message}`);
  }
});

/* The storefront page must never point at a script we don't ship. */
const storeHtml = fs.readFileSync(path.join(ROOT, 'public/store/index.html'), 'utf8');
for (const [, src] of storeHtml.matchAll(/<script[^>]+src="([^"]+)"/g)) {
  const file = path.join(ROOT, 'public', src.replace(/^\//, ''));
  if (!fs.existsSync(file)) {
    failures += 1;
    console.log(`  ✗ public/store/index.html references missing ${src}`);
  } else {
    console.log(`  ✓ ${src} exists`);
  }
}

/* Every internal link, image and font the site points at must exist in public/.
   Catches a build that dropped an asset, or copy that links to a page we never
   generated — both only show up as a 404 after deploying otherwise. */
const PAGES = [
  'store/index.html',
  'store/shipping.html',
  'store/care.html',
  'store/contact.html',
  'index.html',
  'admin/index.html',
  'privacy.html',
  'terms.html',
  'refund-policy.html',
];

const exists = (relative) => {
  const file = path.join(ROOT, 'public', relative);
  return fs.existsSync(file) && fs.statSync(file).isFile();
};

const internalRefs = new Set();
for (const page of PAGES) {
  const file = path.join(ROOT, 'public', page);
  if (!fs.existsSync(file)) {
    failures += 1;
    console.log(`  ✗ public/${page} — missing`);
    continue;
  }
  const html = fs.readFileSync(file, 'utf8');
  // Root-relative, plus absolute-URL asset references (og:image, canonicals)
  // that still have to point at a file we actually publish.
  for (const match of html.matchAll(/(?:href|src|content)="(\/[^"#?]*)/g)) internalRefs.add(match[1]);
  for (const match of html.matchAll(/https?:\/\/[^\s"']*armoniaconnect\.com(\/[^"#?\s]*)/g)) internalRefs.add(match[1]);
}

const danglingLinks = [];
for (const url of internalRefs) {
  if (url.startsWith('/api/')) continue; // serverless routes, not files
  const candidates = [url, `${url.replace(/\/$/, '')}/index.html`, `${url}.html`, `${url}/index.html`];
  if (!candidates.some(exists)) danglingLinks.push(url);
}
if (danglingLinks.length) {
  failures += danglingLinks.length;
  for (const url of danglingLinks) console.log(`  ✗ link points at nothing: ${url}`);
} else {
  console.log(`  ✓ ${internalRefs.size} internal links resolve`);
}

const fontUrls = new Set();
for (const css of ['store/base.css', 'store/fonts.css']) {
  const file = path.join(ROOT, 'public', css);
  if (!fs.existsSync(file)) continue;
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/url\(\s*['"]?(\/[^'")]+)['"]?\s*\)/g)) {
    fontUrls.add(match[1]);
  }
}
const missingFonts = [...fontUrls].filter((url) => !exists(url.replace(/^\//, '')));
if (missingFonts.length) {
  failures += missingFonts.length;
  for (const url of missingFonts) console.log(`  ✗ stylesheet references missing font: ${url}`);
} else {
  console.log(`  ✓ ${fontUrls.size} font files present`);
}

/* Image paths inside the shipped bundle must all land on a real file. The
   compiled export addresses images from its own hosting root, so a missed
   rebase silently 404s every product photo — invisible in a build log, very
   visible on the storefront. */
const bundleFile = path.join(ROOT, 'public/store/frontend.js');
if (fs.existsSync(bundleFile)) {
  const bundle = fs.readFileSync(bundleFile, 'utf8');
  const stray = (bundle.match(/(?<!store)\/images\//g) || []).length;
  if (stray) {
    failures += 1;
    console.log(`  ✗ ${stray} image reference(s) still point at /images/ instead of /store/images/`);
  } else {
    console.log('  ✓ bundle image paths are rebased to /store/images/');
  }

  const staticRefs = new Set(
    [...bundle.matchAll(/\/store\/images\/([A-Za-z0-9._-]+\.(?:webp|png|jpg|jpeg|svg))/g)].map((m) => m[1]),
  );
  const absent = [...staticRefs].filter((name) => !exists(`store/images/${name}`));
  if (absent.length) {
    failures += absent.length;
    for (const name of absent) console.log(`  ✗ bundle references missing image: /store/images/${name}`);
  } else {
    console.log(`  ✓ ${staticRefs.size} bundle image paths exist`);
  }
}

/* The page config carries a second, independent copy of the product image
   maps (each product's `images` / `backImages`). Those are data, not bundle
   code, so a missed rebase there breaks products the bundle check cannot see.
   Every generated store page is checked, for both forms of the path. */
for (const name of PAGES.filter((p) => p.startsWith('store/'))) {
  const file = path.join(ROOT, 'public', name);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  const stray = (html.match(/(?<!store)\/images\//g) || []).length;
  if (stray) {
    failures += 1;
    console.log(`  ✗ ${name}: ${stray} image reference(s) still point at /images/`);
  } else {
    console.log(`  ✓ ${name}: page image paths are rebased`);
  }
}

/* `--check` only proves a file parses. It cannot catch an identifier that is
   used but never imported: that is a ReferenceError at request time, on one
   route, minutes after deploy. It shipped twice, so it is now a gate.

   Importing the module does not help — a free variable inside a function body
   only fails when that function runs. So this reads the source and checks that
   every capitalised call and every `X.y(` receiver resolves to an import, a
   local, or a known global. Crude, but it is exactly the shape of the bug. */
const KNOWN_GLOBALS = new Set([
  'console', 'process', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Math',
  'Date', 'Promise', 'Error', 'RegExp', 'Map', 'Set', 'Buffer', 'fetch', 'URL',
  'setTimeout', 'clearTimeout', 'encodeURIComponent', 'decodeURIComponent', 'parseInt',
  'parseFloat', 'isNaN', 'require', 'globalThis', 'Intl', 'Set', 'WeakMap', 'structuredClone',
]);

for (const relative of ['api/admin/[...slug].js', 'api/store/[...slug].js']) {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) continue;
  const raw = fs.readFileSync(file, 'utf8');
  // Strip comments and string/template contents first. Without this, prose like
  // "creates the products (instead of clicking)" looks like calls to
  // `products()` and `instead()`, and the check drowns in false positives.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/(?<![:\\])\/\/.*$/gm, ' ')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');

  // Anything imported under any name/alias.
  const imported = new Set();
  for (const m of raw.matchAll(/import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/g)) {
    for (const name of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) imported.add(name[0]);
  }
  // Locals: declarations, function params, destructuring, catch bindings.
  const declared = new Set();
  for (const m of raw.matchAll(/\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of raw.matchAll(/\b(?:const|let)\s*\{([^}]*)\}/g)) {
    for (const part of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) declared.add(part[0]);
  }
  for (const m of raw.matchAll(/\(([^)]*)\)\s*=>/g)) {
    for (const part of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) declared.add(part[0]);
  }
  for (const m of raw.matchAll(/function[\s\S]*?\(([^)]*)\)/g)) {
    for (const part of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) declared.add(part[0]);
  }
  for (const m of raw.matchAll(/catch\s*\(([A-Za-z_$][\w$]*)\)/g)) declared.add(m[1]);
  for (const m of raw.matchAll(/for\s*\(\s*(?:const|let)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);

  const unknown = new Set();
  // A call to a capitalised name, e.g. buildSyncPlan(...) — the exact bug.
  for (const m of src.matchAll(/(?<![.\w$])([a-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (KNOWN_GLOBALS.has(name) || imported.has(name) || declared.has(name)) continue;
    // Skip keywords and method names written after a dot.
    if (/^(if|for|while|switch|catch|function|return|typeof|new|await|async|else|do|try|import)$/.test(name)) continue;
    unknown.add(name);
  }
  // A receiver of a known-exported helper, e.g. printful.listSyncProducts(
  for (const m of src.matchAll(/(?<![.\w$])([a-z_$][\w$]*)\.[A-Za-z_$][\w$]*\s*\(/g)) {
    const name = m[1];
    if (KNOWN_GLOBALS.has(name) || imported.has(name) || declared.has(name)) continue;
    if (/^(req|res|err|json|process)$/.test(name)) continue;
    unknown.add(name);
  }

  if (unknown.size) {
    failures += 1;
    console.log(`  ✗ ${relative}: used but never imported or declared — ${[...unknown].join(', ')}`);
  } else {
    console.log(`  ✓ ${relative}: no unresolved identifiers`);
  }
}

/* The column list in lib/store/db.js must match the schema. PostgREST rejects a
   whole row for one unknown column, so a typo there fails every product at once
   with an error that blames the schema. Read both and compare. */
{
  const dbSrc = fs.readFileSync(path.join(ROOT, 'lib/store/db.js'), 'utf8');
  const listMatch = dbSrc.match(/const PRODUCT_COLUMNS = \[([\s\S]*?)\];/);
  const schemaSrc = fs.readFileSync(path.join(ROOT, 'supabase/schema-v15.sql'), 'utf8');
  const tableMatch = schemaSrc.match(/create table if not exists store_products \(([\s\S]*?)\n\);/);

  if (!listMatch || !tableMatch) {
    failures += 1;
    console.log('  ✗ store_products column list — could not read one side of the comparison');
  } else {
    const listed = new Set([...listMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    // Column definitions look like "  name   type ..." at the start of a line.
    const schemaCols = new Set(
      [...tableMatch[1].matchAll(/^\s{2}([a-z_]+)\s+[a-z]/gm)].map((m) => m[1])
    );
    const missingFromCode = [...schemaCols].filter((c) => !listed.has(c));
    const notInSchema = [...listed].filter((c) => !schemaCols.has(c));
    if (missingFromCode.length || notInSchema.length) {
      failures += 1;
      console.log(`  ✗ store_products columns drift — code is missing [${missingFromCode.join(', ')}], schema lacks [${notInSchema.join(', ')}]`);
    } else {
      console.log(`  ✓ store_products column list matches the schema (${listed.size})`);
    }
  }
}

/* ── the page must sell what the API sells ──────────────────────────────
   The single worst failure this store can have is a page that advertises one
   thing while the server sells another. It happened: the catalogue was replaced
   in the database, the generated page kept six deleted products, and their ids
   no longer matched any live row — so every price on the page was wrong, in the
   shop's favour, and the runtime's price patch had nothing to paint.

   Two assertions, both cheap:
     1. every product baked into the page exists in the catalogue file, and
     2. the page's prices equal the file's, which the build has already set
        from the database rows. */
{
  const pageFile = path.join(ROOT, 'public/store/index.html');
  const catalogFile = path.join(ROOT, 'store/catalog.json');
  if (fs.existsSync(pageFile) && fs.existsSync(catalogFile)) {
    const html = fs.readFileSync(pageFile, 'utf8');
    const match = html.match(/<script type="application\/json" id="armonia-config">([\s\S]*?)<\/script>/);
    const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
    if (!match) {
      failures += 1;
      console.log('  ✗ public/store/index.html has no armonia-config block');
    } else {
      const baked = JSON.parse(match[1]);
      const fileById = new Map((catalog.products || []).map((p) => [p.id, p]));
      const ghosts = (baked.products || []).filter((p) => !fileById.has(p.id)).map((p) => p.id);
      const wrongPrice = (baked.products || [])
        .filter((p) => fileById.has(p.id) && Math.abs((fileById.get(p.id).price || 0) - (p.price || 0)) > 0.001)
        .map((p) => `${p.id} page $${p.price} vs catalogue $${fileById.get(p.id).price}`);

      // The other direction: a product the API will happily sell but the page
      // never shows. Less dangerous than a ghost price, and just as invisible.
      const pageById = new Set((baked.products || []).map((p) => p.id));
      const missing = (catalog.products || []).filter((p) => !pageById.has(p.id)).map((p) => p.id);

      if (ghosts.length) {
        failures += 1;
        console.log(`  ✗ the page sells ${ghosts.length} product(s) not in the catalogue: ${ghosts.join(', ')}`);
        console.log('    run `node store/sync-catalog-file.mjs` then `npm run build:store`');
      } else if (missing.length) {
        failures += 1;
        console.log(`  ✗ the catalogue sells ${missing.length} product(s) the page does not show: ${missing.join(', ')}`);
        console.log('    run `npm run build:store`');
      } else if (wrongPrice.length) {
        failures += 1;
        for (const line of wrongPrice) console.log(`  ✗ price drift — ${line}`);
        console.log('    run `npm run build:store` to fold the current prices in');
      } else if (baked.featuredId && !(baked.products || []).some((p) => p.id === baked.featuredId)) {
        failures += 1;
        console.log(`  ✗ featuredId "${baked.featuredId}" is not one of the products on the page`);
      } else if (baked.upsellId && !(baked.products || []).some((p) => p.id === baked.upsellId)) {
        failures += 1;
        console.log(`  ✗ upsellId "${baked.upsellId}" is not one of the products on the page`);
      } else {
        console.log(`  ✓ page sells exactly the catalogue's ${(baked.products || []).length} products, at its prices`);
      }
    }
  }
}

/* ── the seasonal switch must not be baked in ───────────────────────────
   The decorations are a live setting now. If a season flag creeps back into
   the built page, the admin switch silently stops controlling that surface. */
{
  const pageFile = path.join(ROOT, 'public/store/index.html');
  if (fs.existsSync(pageFile)) {
    const html = fs.readFileSync(pageFile, 'utf8');
    const baked = ['fallFlares', 'decorationsOn', 'decorations_on'];
    const found = baked.filter((key) => html.includes(`"${key}"`));
    if (found.length) {
      failures += 1;
      console.log(`  ✗ the page bakes a seasonal flag (${found.join(', ')}) — the admin switch cannot control it`);
    } else {
      console.log('  ✓ no seasonal flag is baked into the page');
    }
  }
}

console.log(failures ? `\n${failures} problem${failures === 1 ? '' : 's'} found.` : '\nAll good.');
process.exit(failures ? 1 : 0);
