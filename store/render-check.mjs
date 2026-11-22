#!/usr/bin/env node
/**
 * Render check — does the built storefront actually paint?
 * ---------------------------------------------------------------------------
 * `node --check` proves a file parses. That is necessary and not sufficient:
 * a bundle can parse and still throw on the first line that runs, which leaves
 * an empty <div id="root"> and a white page. This loads the real generated
 * page, the real generated bundle and the real runtime into a DOM and asserts
 * that something rendered.
 *
 * WHY THIS EXISTS
 * A build patch left `const _unused=[` inside a function, the bundle became a
 * SyntaxError, `npm run check` passed, Vercel passed, and the live store was
 * blank. The parse gate in check.mjs now catches that exact case; this catches
 * the next one — the one that parses fine and crashes at runtime.
 *
 * Usage
 *   node store/render-check.mjs
 *
 * Skips (exit 0, with a notice) when jsdom is not installed, so a minimal
 * checkout can still run `npm run check`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('  ~ render check skipped (jsdom is not installed)');
  process.exit(0);
}

const files = {
  page: 'public/store/index.html',
  frontend: 'public/store/frontend.js',
  live: 'public/store/live.js',
  css: 'public/store/base.css',
};
for (const [name, relative] of Object.entries(files)) {
  if (!fs.existsSync(path.join(ROOT, relative))) {
    console.log(`  ✗ render check — missing ${relative} (${name}); run npm run build:store`);
    process.exit(1);
  }
}

const errors = [];
const dom = new JSDOM(read(files.page), {
  url: 'https://www.armoniaconnect.com/store/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const w = dom.window;

// The page's own scripts are modules served over HTTP; here they are evaluated
// directly, which is close enough to catch a crash before first paint.
w.console.error = (...args) => errors.push(`console.error: ${args.join(' ').slice(0, 160)}`);
w.addEventListener('error', (event) => errors.push(`window error: ${event.message}`));

// jsdom has no network and no media queries. Both are stubbed to their
// "nothing available" answers, which is the state the storefront must survive:
// it is the same code path as a shopper whose catalogue request fails.
w.matchMedia = w.matchMedia || ((query) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
}));
w.fetch = () => Promise.reject(new Error('offline in the render check'));
w.IntersectionObserver = w.IntersectionObserver || class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
w.requestAnimationFrame = w.requestAnimationFrame || ((cb) => setTimeout(cb, 0));

try {
  // The page loads live.js first, then frontend.js.
  w.eval(read(files.live));
  w.eval(read(files.frontend));
} catch (err) {
  errors.push(`THREW: ${err.message}`);
}

await new Promise((resolve) => setTimeout(resolve, 400));

const root = w.document.getElementById('root');
const rendered = root ? root.innerHTML : '';
const productCards = (rendered.match(/product-name/g) || []).length;

/* The runtime starts a 60-second price watcher on boot, so jsdom keeps the
   event loop alive forever. Close it explicitly or `npm run check` hangs. */
const done = (code) => {
  try { dom.window.close(); } catch { /* already gone */ }
  process.exit(code);
};

if (errors.length) {
  console.log('  ✗ render check — the storefront threw before it painted:');
  for (const line of [...new Set(errors)].slice(0, 5)) console.log(`      ${line}`);
  done(1);
}

if (!root || rendered.length < 2000) {
  console.log(`  ✗ render check — nothing rendered (${rendered.length} bytes in #root). The page would be blank.`);
  done(1);
}

if (productCards === 0) {
  console.log('  ✗ render check — the page painted but shows no products');
  done(1);
}

console.log(`  ✓ render check — storefront paints (${productCards} product cards, ${(rendered.length / 1024).toFixed(0)} KB)`);
done(0);
