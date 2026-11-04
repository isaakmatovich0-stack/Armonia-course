#!/usr/bin/env node
/**
 * ARMONIA CONNECT — storefront build
 * ---------------------------------------------------------------------------
 * The design for this store was authored in Armonia Studio, which exports a
 * single, completely self-contained HTML file (every image and font inlined as
 * base64, demo checkout included). That export is great as a design artefact
 * and terrible as a website: 7.4 MB on every page view, and no real commerce.
 *
 * This script turns the export into a normal, fast, version-controllable site:
 *
 *   public/store/index.html      the page (a few KB of markup)
 *   public/store/base.css        the exported stylesheet, fonts un-inlined
 *   public/store/fonts.css       @font-face rules pointing at the .ttf files
 *   public/store/fonts/*.ttf     Manrope + DM Sans, served with long cache
 *   public/store/images/*        43 product/hero images as real .webp files
 *   store/frontend.bundle.js     the exported app code + the live-store bridge
 *   public/store/frontend.js     the same bundle, served to browsers
 *   store/runtime.js             the live bag / checkout / policy runtime
 *   public/store/live.js         the same runtime, served to browsers
 *   store/catalog.json           the exported catalog (products, colours,
 *                                prices) — the server prices every order from
 *                                this file, so the browser cannot change a
 *                                price by editing the page
 *
 * The two store/ → public/store/ copies exist because everything under
 * public/ is what Vercel serves. Edit the file in store/, then run this
 * script (it is part of every build).
 *
 * Usage
 *   node store/build-store.mjs                     rebuild the page from the
 *                                                  committed bundle + catalog
 *   node store/build-store.mjs --export x.html     re-extract everything from
 *                                                  a fresh Studio export
 *
 * Run `node store/build-store.mjs` after editing store/catalog.json (prices,
 * colours, copy) so the page and the server agree.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = {
  page: path.join(ROOT, 'public/store/index.html'),
  shipping: path.join(ROOT, 'public/store/shipping.html'),
  care: path.join(ROOT, 'public/store/care.html'),
  contact: path.join(ROOT, 'public/store/contact.html'),
  css: path.join(ROOT, 'public/store/base.css'),
  fontsCss: path.join(ROOT, 'public/store/fonts.css'),
  fontsDir: path.join(ROOT, 'public/store/fonts'),
  imagesDir: path.join(ROOT, 'public/store/images'),
  bundle: path.join(ROOT, 'store/frontend.bundle.js'),
  runtime: path.join(ROOT, 'store/runtime.js'),
  runtimePublic: path.join(ROOT, 'public/store/live.js'),
  catalog: path.join(ROOT, 'store/catalog.json'),
};

const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  const kb = (Buffer.byteLength(data) / 1024).toFixed(1);
  console.log(`  ${path.relative(ROOT, file).padEnd(38)} ${kb} KB`);
};

/* ─────────────────────────────── extraction ─────────────────────────────── */

function extractExport(exportPath) {
  const html = fs.readFileSync(exportPath, 'utf8');
  const pick = (regex, what) => {
    const match = html.match(regex);
    if (!match) throw new Error(`Could not find ${what} in the export.`);
    return match;
  };

  const baseCss = pick(/<style id="armonia-base-css">([\s\S]*?)<\/style>/, 'the base stylesheet')[1];
  const appCode = pick(/<script type="module" id="armonia-app-code">([\s\S]*?)<\/script>/, 'the app code')[1];
  const config = JSON.parse(pick(/<script type="application\/json" id="armonia-config">([\s\S]*?)<\/script>/, 'the store config')[1]);
  const runtimeAssets = JSON.parse(
    pick(/<script id="armonia-assets">globalThis\.__ARMONIA_ASSETS__=(\{[\s\S]*?\})<\/script>/, 'the inlined asset map')[1],
  );
  const licenses = (html.match(/<script type="application\/json" id="open-source-licenses">([\s\S]*?)<\/script>/) || [])[1] || null;

  /* — images — */
  const assetMap = { ...runtimeAssets, ...(config.assets || {}) };
  fs.mkdirSync(OUT.imagesDir, { recursive: true });
  let imageBytes = 0;
  for (const [assetPath, value] of Object.entries(assetMap)) {
    if (typeof value !== 'string' || !value.startsWith('data:')) continue;
    const [, base64] = value.split(',');
    const name = path.basename(assetPath);
    if (!name) continue;
    const buf = Buffer.from(base64, 'base64');
    imageBytes += buf.length;
    fs.writeFileSync(path.join(OUT.imagesDir, name), buf);
  }
  // Brand marks travel in the config rather than the asset map.
  for (const [key, value] of [['logo', config.brand && config.brand.logo], ['favicon', config.brand && config.brand.favicon]]) {
    if (typeof value !== 'string' || !value.startsWith('data:')) continue;
    const [, base64] = value.split(',');
    const ext = value.startsWith('data:image/png') ? 'png' : 'webp';
    const name = key === 'logo' ? 'brand-logo.webp' : `favicon-store.${ext}`;
    fs.writeFileSync(path.join(OUT.imagesDir, name), Buffer.from(base64, 'base64'));
  }
  console.log(`  images: ${Object.keys(assetMap).length} files, ${(imageBytes / 1024 / 1024).toFixed(2)} MB`);

  /* — fonts: 5 Manrope weights + 2 DM Sans weights, inlined in the CSS — */
  fs.mkdirSync(OUT.fontsDir, { recursive: true });
  const faces = [];
  const faceRegex = /@font-face\{([^}]*)\}/g;
  let face;
  while ((face = faceRegex.exec(baseCss))) {
    const body = face[1];
    if (!/src:url\(data:font/.test(body)) continue;
    const family = (body.match(/font-family:([^;]+);/) || [])[1];
    const weight = (body.match(/font-weight:([^;]+);/) || [])[1] || '400';
    const src = (body.match(/src:url\(([^)]+)\)/) || [])[1];
    if (!family || !src) continue;
    const subtype = (src.match(/^data:(font\/[a-z0-9]+);base64,/) || [])[1] || 'font/ttf';
    const ext = subtype.includes('woff2') ? 'woff2' : subtype.includes('woff') ? 'woff' : 'ttf';
    const slug = `${family.replace(/\s+/g, '')}-${weight}.${ext}`;
    fs.writeFileSync(path.join(OUT.fontsDir, slug), Buffer.from(src.split(',')[1], 'base64'));
    faces.push({ family, weight, slug, format: ext === 'woff2' ? 'woff2' : ext === 'woff' ? 'woff' : 'truetype' });
  }
  const fontsCss = []; // rebuilt below
  write(
    OUT.fontsCss,
    [
      '/* Self-hosted so the store never waits on Google Fonts. */',
      ...faces.map(
        (f) => `@font-face{font-family:${f.family};font-style:normal;font-weight:${f.weight};font-display:swap;src:url(/store/fonts/${f.slug}) format("${f.format}");}`,
      ),
      '',
    ].join('\n'),
  );
  console.log(`  fonts: ${faces.length} files`);

  /* — stylesheet: drop the inlined font data, keep everything else intact — */
  const css = baseCss
    .replace(/@font-face\{[^}]*data:font[^}]*\}/g, '')
    .replace(/url\(data:font[^)]*\)/g, 'none');
  write(OUT.css, `/* Generated by store/build-store.mjs — edit the Studio export, not this file. */\n${css}`);

  /* — catalog: config minus the inlined binaries — */
  const catalog = JSON.parse(JSON.stringify(config));
  delete catalog.assets;
  catalog.brand = { ...(catalog.brand || {}), logo: '/store/images/brand-logo.webp', favicon: '/store/images/favicon-store.png' };
  catalog.site = {
    ...(catalog.site || {}),
    noindex: false,
    title: 'Armonia Connect — Shop the Collection',
    description:
      'Wear your connection. Signature caps, everyday tees, hoodies, windbreakers, fingerpicks and sticker sets from the Armonia Connect collection. Free US shipping over $75.',
  };
  write(OUT.catalog, `${JSON.stringify(catalog, null, 2)}\n`);

  /* — app bundle: the pristine export; main() applies the hooks when publishing — */
  write(OUT.bundle, appCode);
  return { config: catalog, licenses };
}

/* ───────────────────────── panel/src/app.js hooks ───────────────────────── */

/**
 * The Studio export is a finished app: its bag lives in React state and every
 * "Add to bag" writes there. We keep that (the header counter, the drawer, the
 * toasts all keep working) but need two seams so the same actions can hit the
 * server as well:
 *
 *   1. `dt(...)` — the add-to-bag handler. We prepend a delegate that the live
 *      runtime installs; when present it performs the add against
 *      /api/store/bag and then writes the result back into React state.
 *   2. the line that derives the bag count from that state. We prepend a
 *      binding step so the runtime receives the component's setState calls.
 *
 * Both replacements are anchored on exact source text and throw if the export
 * ever changes shape, so a future Studio export can never silently ship a
 * store whose bag only pretends to be real.
 */
const PATCHES = [
  {
    name: 'add-to-bag delegate',
    find: 'dt=(_,W,_e,re=1,g=!1)=>{',
    replace: 'dt=(_,W,_e,re=1,g=!1)=>{if(globalThis.__armoniaAddLive&&globalThis.__armoniaAddLive(_,W,_e,re,g))return;',
  },
  {
    name: 'bag-state binding',
    find: ',$=y.reduce((_,W)=>_+W.quantity,0),',
    replace: ',$=(globalThis.__armoniaBindBag&&globalThis.__armoniaBindBag(h,A),y.reduce((_,W)=>_+W.quantity,0)),',
  },
  {
    // The export's product accordion still talks about a "launch plan" and a
    // "preview collection". Shipping and returns are real now, so the copy is
    // rewritten to describe what actually happens. Fe(Gc) and Fe(ba) are the
    // bundle's own money formatters, so live prices keep flowing through.
    name: 'shipping accordion copy',
    find: `children:["Launch plan: ",Fe(Gc)," standard US shipping, free for orders"," ",Fe(ba),"+. A 30-day return window is planned for unworn goods. This is a preview collection; fulfillment and final policies will be connected before launch."]`,
    replace: `children:["Standard US shipping is ",Fe(Gc),", free on orders"," ",Fe(ba),"+. Unworn, unused goods can be returned within 30 days of delivery — we send a prepaid label for US orders, and tracking lands in your inbox the moment your parcel ships."]`,
  },
  {
    // Footer's "STORE PREVIEW" badge is a leftover from the demo export. The
    // runtime also relabels it, but fixing it at the source means the badge is
    // correct on the very first paint (and for anyone without JS timing luck).
    name: 'footer preview badge',
    find: 'className:"preview-label",children:[u.jsx("span",{})," STORE PREVIEW"]',
    replace: 'className:"preview-label",children:[u.jsx("span",{})," SECURE CHECKOUT"]',
  },
];

function patchAppCode(code) {
  let patched = code;
  for (const patch of PATCHES) {
    const count = patched.split(patch.find).length - 1;
    if (count !== 1) {
      throw new Error(
        `The exported app code no longer matches the "${patch.name}" hook (found ${count}× "${patch.find}").\n` +
          'Fix PATCHES in store/build-store.mjs before deploying — without it the bag would not reach /api/store.',
      );
    }
    patched = patched.replace(patch.find, patch.replace);
  }
  return patched;
}

/* ─────────────────────────────── the bridge ─────────────────────────────── */

/**
 * Appended to the exported app code. The bundle is a minified IIFE universe:
 * `B` is React, `u` is the jsx factory, `bg` renders the bag (with the demo
 * checkout), `Eg` renders the info/contact modal, and the last statement
 * mounts the app. We expose exactly those four things so
 * /store/live.js can replace the two demo components with real ones,
 * then start it. Nothing else about the bundle is touched.
 */
const BRIDGE_HOOK = `
/* ── Armonia live-store bridge (injected by store/build-store.mjs) ───────── */
globalThis.ArmoniaBridge = {
  React: B,
  jsx: u.jsx,
  get config() { return globalThis.__ARMONIA_CONFIG__ || {}; },
  /** Swap the two demo components for the live ones. */
  swap(parts) {
    if (parts && typeof parts.bag === 'function') bg = parts.bag;
    if (parts && typeof parts.info === 'function') Eg = parts.info;
    return true;
  },
};
try {
  if (globalThis.ArmoniaLive) globalThis.ArmoniaLive.start(globalThis.ArmoniaBridge);
  else console.error('[store] store/live.js did not load; the bag falls back to browser storage.');
} catch (err) {
  console.error('[store] live runtime failed to start', err);
}
`;

/* ───────────────────────────── policy pages ───────────────────────────── */

async function renderPages() {
  const { page } = await import(pathToFileURL(path.join(ROOT, 'store/pages/shell.mjs')).href);

  write(
    OUT.shipping,
    page({
      title: 'Shipping & returns',
      description: 'Shipping times, costs and the 30-day return policy for Armonia Connect orders.',
      eyebrow: 'The good-to-know details',
      heading: 'Shipping & returns.',
      current: 'shipping',
      body: `
      <div class="grid">
        <div class="card"><h3 style="margin-top:0">Ships from the US</h3><p style="margin:0">Packed in 2–4 business days, with tracking by email the moment it leaves.</p></div>
        <div class="card"><h3 style="margin-top:0">Free over $75</h3><p style="margin:0">$6 flat standard shipping. Free on orders of $75 or more.</p></div>
        <div class="card"><h3 style="margin-top:0">30-day returns</h3><p style="margin:0">Unworn items, prepaid label for US orders, refunded within 5 business days.</p></div>
      </div>

      <div class="rule">${'<svg viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><path d="M50 0C50 33 67 50 100 50C67 50 50 67 50 100C50 67 33 50 0 50C33 50 50 33 50 0Z"/></svg>'}<i></i></div>

      <h2>Shipping</h2>
      <p>Orders are packed and handed to the carrier within 2–4 business days. Standard shipping within the United States is <strong>$6</strong>, and free on orders of <strong>$75</strong> or more. Delivery after dispatch is typically 3–6 business days.</p>
      <p>You’ll get a confirmation as soon as you order and a tracking link as soon as your parcel is on its way. We ship within the United States only for now.</p>

      <h2 id="returns">Returns &amp; exchanges</h2>
      <p>If something isn’t right, you have <strong>30 days from delivery</strong> to return unworn, unused items in their original condition and packaging. We’ll send a prepaid return label for US orders.</p>
      <ul>
        <li>Email the address on your receipt (or <a class="link" href="/store/contact">use this form</a>) with your order number.</li>
        <li>We’ll reply with a prepaid label and drop-off instructions.</li>
        <li>Refunds go back to your original payment method within 5 business days of the return arriving.</li>
      </ul>
      <p>Exchanges work the same way: tell us the size or colour you’d like and we’ll reserve it while your return travels back. Sticker sets and fingerpicks can only be returned if the packaging is unopened, and caps must be unworn with the original tags.</p>

      <h2>Something arrived damaged?</h2>
      <p>Send a photo within 7 days of delivery and we’ll replace it or refund it — your choice. That’s on us, not on you.</p>

      <p style="margin-top:30px"><a class="cta" href="/store/">Back to the collection</a></p>
      `,
    }),
  );

  write(
    OUT.care,
    page({
      title: 'Product care',
      description: 'How to wash, dry and store your Armonia Connect pieces so they stay good as new.',
      eyebrow: 'A little care goes a long way',
      heading: 'Keep your good things good.',
      current: 'care',
      body: `
      <div class="card">
        <h2 style="margin-top:0">Tees &amp; hoodies</h2>
        <p>Turn inside out, wash cold with similar colours, and air dry. Heat is the only thing that ages cotton and embroidery — keep it out of the dryer and off the iron.</p>
        <ul><li>Machine wash cold, gentle cycle</li><li>Do not iron directly over the emblem</li><li>Air dry flat or line dry</li></ul>
      </div>
      <div class="card">
        <h2 style="margin-top:0">Windbreakers</h2>
        <p>Zip everything closed, wash cold on a gentle cycle, hang to dry. The water-resistant finish does not like heat or fabric softener.</p>
        <ul><li>No tumble drying, no dry cleaning</li><li>Refresh the water resistance with a cool iron through a cloth — never directly</li></ul>
      </div>
      <div class="card">
        <h2 style="margin-top:0">Caps &amp; totes</h2>
        <p>Spot clean with mild soap and cold water, reshape the cap while damp, and let it air dry. No bleach, no washing machine.</p>
      </div>
      <div class="card">
        <h2 style="margin-top:0">Stickers, fingerpicks &amp; bottles</h2>
        <p>Apply stickers to a clean, dry, smooth surface and press from the middle out. Wipe fingerpicks with a soft cloth after playing. Hand wash bottles — the foil emblem prefers it.</p>
      </div>
      <p style="margin-top:30px"><a class="cta" href="/store/">Back to the collection</a></p>
      `,
    }),
  );

  write(
    OUT.contact,
    page({
      title: 'Contact',
      description: 'Questions about an Armonia Connect order, sizing or a return? Send us a note — a real person replies.',
      eyebrow: 'Let’s make a connection',
      heading: 'Hey, good company.',
      current: 'contact',
      body: `
      <p>Questions about an order, sizing, or a return? Send a note and a real person will reply — usually within one business day.</p>
      <form data-contact novalidate>
        <label>Your name<input name="name" required maxlength="100" autocomplete="name" placeholder="Alex Garcia"></label>
        <label>Email address<input name="email" type="email" required maxlength="150" autocomplete="email" placeholder="you@example.com"></label>
        <label>Subject<input name="subject" maxlength="140" placeholder="Question about the Connection Hoodie"></label>
        <label>Your message<textarea name="message" required maxlength="2000" placeholder="Tell us what’s on your mind…"></textarea></label>
        <div><button class="cta" type="submit">Send message</button></div>
        <p class="note">Prefer email? Write to <a class="link" href="mailto:maestro.armoniaconnect@gmail.com">maestro.armoniaconnect@gmail.com</a>. See our <a class="link" href="/privacy.html">privacy policy</a>.</p>
        <p class="status" data-status role="status"></p>
      </form>
      <div class="rule"><svg viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><path d="M50 0C50 33 67 50 100 50C67 50 50 67 50 100C50 67 33 50 0 50C33 50 50 33 50 0Z"/></svg><i></i></div>
      <h2>Before you write</h2>
      <ul>
        <li><strong>Where’s my order?</strong> Tracking is emailed at dispatch — check your spam folder, then send us the order number (AC-XXXXXX).</li>
        <li><strong>Sizing:</strong> the tees and hoodies are a relaxed unisex fit. Garment chest widths (laid flat) are in the size guide on each product page.</li>
        <li><strong>Returns:</strong> everything you need is on the <a class="link" href="/store/shipping#returns">shipping &amp; returns</a> page.</li>
      </ul>
      `,
    }),
  );
}

/* ────────────────────────────────── page ────────────────────────────────── */

function renderPage(config, { licenses } = {}) {
  const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const catalogAttrs = {
    'data-commerce': 'live',
    'data-colors': json(config.colors || {}),
    'data-products': json(
      (config.products || []).map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        price: p.price,
        colors: p.colors,
        sizes: p.sizes,
      })),
    ),
  };
  const attrString = Object.entries(catalogAttrs)
    .map(([key, value]) => `${key}="${String(value).replace(/"/g, '&quot;')}"`)
    .join(' ');

  const title = config.site.title;
  const description = config.site.description;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="#142225">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://www.armoniaconnect.com/store/">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Armonia Connect">
<meta property="og:url" content="https://www.armoniaconnect.com/store/">
<meta property="og:image" content="https://www.armoniaconnect.com/store/images/community.webp">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="/store/images/favicon-store.png">
<link rel="apple-touch-icon" href="/store/images/favicon-store.png">
<link rel="preconnect" href="https://checkout.stripe.com">
<link rel="preload" as="font" type="font/ttf" href="/store/fonts/Manrope-500.ttf" crossorigin>
<link rel="stylesheet" href="/store/fonts.css">
<link rel="stylesheet" href="/store/base.css">
<script>globalThis.__ARMONIA_SELF_CONTAINED__=true;globalThis.__ARMONIA_FRAME__=false;globalThis.__ARMONIA_SELECT__=false;globalThis.__ARMONIA_DISABLE_EDITOR__=true;</script>
<script type="application/json" id="armonia-config">${json(config)}</script>
</head>
<body ${attrString}>
<div id="root"></div>
<noscript>
  <div style="padding:48px 24px;font-family:Georgia,serif;background:#f6f3eb;color:#142529;text-align:center">
    <h1 style="font-size:28px">Armonia Connect</h1>
    <p>This store needs JavaScript to show the collection, bag and checkout.</p>
    <p>Prefer email? Write to <a href="mailto:maestro.armoniaconnect@gmail.com">maestro.armoniaconnect@gmail.com</a> and we will sort you out.</p>
  </div>
</noscript>
<script type="module" src="/store/live.js"></script>
<script type="module" src="/store/frontend.js"></script>
${licenses ? `<script type="application/json" id="open-source-licenses">${licenses}</script>` : ''}
</body>
</html>
`;
}

/* ─────────────────────────────────── run ─────────────────────────────────── */

async function main() {
  const args = process.argv.slice(2);
  const exportIndex = args.indexOf('--export');
  console.log('Armonia store build');

  let config;
  let licenses = null;

  if (exportIndex !== -1) {
    const exportPath = args[exportIndex + 1];
    if (!exportPath || !fs.existsSync(exportPath)) {
      console.error(`\nUsage: node store/build-store.mjs --export path/to/studio-export.html\n(hint: pass the exported "index.html" from Armonia Studio)`);
      process.exit(1);
    }
    console.log(`  extracting from ${path.basename(exportPath)}`);
    ({ config, licenses } = extractExport(exportPath));
  } else {
    for (const file of [OUT.catalog, OUT.bundle, OUT.css]) {
      if (!fs.existsSync(file)) {
        console.error(`\n  missing ${path.relative(ROOT, file)} — run with --export <studio-export.html> once.\n`);
        process.exit(1);
      }
    }
    config = JSON.parse(fs.readFileSync(OUT.catalog, 'utf8'));
    const licensesMatch = fs.readFileSync(OUT.page, 'utf8').match(/<script type="application\/json" id="open-source-licenses">([\s\S]*?)<\/script>/);
    licenses = licensesMatch ? licensesMatch[1] : null;
  }

  // Publish the browser assets. store/frontend.bundle.js is the pristine
  // export; the hooks and the bridge are applied here, on the way out, so the
  // patch can never be applied twice.
  if (!fs.existsSync(OUT.bundle)) {
    console.error(`\n  missing ${path.relative(ROOT, OUT.bundle)} — run with --export <studio-export.html> once.\n`);
    process.exit(1);
  }
  const appCode = patchAppCode(fs.readFileSync(OUT.bundle, 'utf8'));
  write(path.join(ROOT, 'public/store/frontend.js'), `${appCode}\n${BRIDGE_HOOK}`);
  if (fs.existsSync(OUT.runtime)) write(OUT.runtimePublic, fs.readFileSync(OUT.runtime));

  write(OUT.page, renderPage(config, { licenses }));
  await renderPages();
  console.log('  done — the store is at /store/');
}

main().catch((err) => {
  console.error(`\n  build failed: ${err.message}\n`);
  process.exit(1);
});
