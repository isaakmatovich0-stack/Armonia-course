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

console.log(failures ? `\n${failures} problem${failures === 1 ? '' : 's'} found.` : '\nAll good.');
process.exit(failures ? 1 : 0);
