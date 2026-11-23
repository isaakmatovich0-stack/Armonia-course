#!/usr/bin/env node
/**
 * Photo check — does a colour change actually change the picture?
 * ---------------------------------------------------------------------------
 * This is the bug the owner reported twice, so it gets its own gate.
 *
 * The storefront renders a product photo through `Or(product, colour)`, a
 * function patched into the compiled bundle at build time. It resolves, in
 * order: the live Printful mockup, the page's baked-in image map, a local file
 * named after the colour, then a neutral placeholder.
 *
 * The first version checked the baked-in map FIRST. That map still holds the
 * old local stand-ins (`hoodie-ink.webp`), so every re-render snapped back to a
 * stand-in: clicking a swatch looked like it did nothing, and the shop showed a
 * picture that was not Printful's mockup at all. Nothing caught it because the
 * bug only appears on the SECOND render — first paint looked fine.
 *
 * So this drives a real render twice: once on boot, once after a swatch click.
 * It also asserts the negative case that matters just as much — a colour with
 * no mockup must fall back to the placeholder, never to another colour's photo.
 *
 * Usage
 *   node store/photo-check.mjs
 *
 * Skips (exit 0, with a notice) when jsdom is not installed.
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
  console.log('  ~ photo check skipped (jsdom is not installed)');
  process.exit(0);
}

const required = ['public/store/index.html', 'public/store/frontend.js', 'public/store/live.js'];
for (const relative of required) {
  if (!fs.existsSync(path.join(ROOT, relative))) {
    console.log(`  ✗ photo check — missing ${relative}; run npm run build:store`);
    process.exit(1);
  }
}

const mockup = (stem) => `https://files.cdn.printful.com/files/${stem}_preview.png`;

/* Two products, shaped exactly like the real catalogue endpoint's payload:
   - the hoodie HAS mockups for both colours;
   - the hat has a mockup for Black only, so Navy Blue must not borrow it. */
const payload = {
  products: [
    {
      id: 'unisex-classic-tee', colors: ['Black', 'Maroon', 'Navy'], sizes: ['M'],
      priceCents: 2050, inStock: true, images: { Black: mockup('tee-black') },
    },
    {
      id: 'hoodie-embroidered',
      colors: ['Black', 'Navy'],
      sizes: ['M'],
      priceCents: 4150,
      inStock: true,
      images: { Black: mockup('hoodie-black'), Navy: mockup('hoodie-navy') },
    },
    {
      id: 'hat-embroidered',
      colors: ['Black', 'Navy Blue'],
      sizes: ['ONE SIZE'],
      priceCents: 2300,
      inStock: true,
      images: { Black: mockup('hat-black') },
    },
  ],
  colors: {},
  decoration: { on: false, name: '', text: '' },
  shipping: {
    countries: ['US'],
    standardShippingCents: 600,
    freeShippingThresholdCents: 7500,
    currency: 'usd',
  },
  checkoutLive: true,
};

const dom = new JSDOM(read('public/store/index.html'), {
  url: 'https://www.armoniaconnect.com/store/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const w = dom.window;
w.console.error = () => {};
w.matchMedia = w.matchMedia || ((query) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
}));
w.IntersectionObserver = w.IntersectionObserver || class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const failures = [];
const fail = (message) => failures.push(message);

try {
  w.eval(read('public/store/live.js'));
  w.eval(read('public/store/frontend.js'));
} catch (error) {
  console.log(`  ✗ photo check — the storefront threw: ${error.message}`);
  process.exit(1);
}

await wait(900);

const photoOf = (id) => {
  const img = w.document.querySelector(`[data-product-id="${id}"] .product-photo`);
  if (!img) return null;
  const src = img.getAttribute('src') || '';
  return { src, placeholder: src.startsWith('data:') };
};

const swatch = (id, colour) => {
  const card = w.document.querySelector(`[data-product-id="${id}"]`);
  if (!card) return false;
  const button = [...card.querySelectorAll('.color-swatch')]
    .find((candidate) => candidate.getAttribute('title') === colour);
  if (!button) return false;
  button.click();
  return true;
};

/* ── first paint ──────────────────────────────────────────────────────── */
{
  const hoodie = photoOf('hoodie-embroidered');
  if (!hoodie) {
    fail('the hoodie card never rendered');
  } else if (!hoodie.src.includes('hoodie-black')) {
    fail(`first paint shows the wrong hoodie photo (${hoodie.src.slice(0, 48)}) — the live mockup was ignored`);
  }
}

/* The hero must show its featured product, never some other black product. */
{
  const hero = w.document.querySelector('.floating-cap img');
  if (!hero || !hero.getAttribute('src').includes('tee-black')) fail('hero did not use the featured tee photo');
  const maroon = w.document.querySelector('.hero-swatch-row [aria-label="Show Unisex classic tee in Maroon"]');
  if (!maroon) fail('featured-product hero colour control is missing');
  else {
    maroon.click(); await wait(300);
    const next = w.document.querySelector('.floating-cap img');
    if (!next || !next.getAttribute('src').startsWith('data:')) fail('hero borrowed a different product or colour when its photo was missing');
  }
}

/* ── second paint, via a swatch click ─────────────────────────────────── */
{
  if (!swatch('hoodie-embroidered', 'Navy')) {
    fail('the hoodie has no Navy swatch to click');
  } else {
    await wait(300);
    const hoodie = photoOf('hoodie-embroidered');
    if (!hoodie || !hoodie.src.includes('hoodie-navy')) {
      fail('clicking Navy did not show the Navy mockup — a re-render fell back to a stale photo');
    }
  }
  if (swatch('hoodie-embroidered', 'Black')) {
    await wait(300);
    const hoodie = photoOf('hoodie-embroidered');
    if (!hoodie || !hoodie.src.includes('hoodie-black')) {
      fail('clicking back to Black lost the mockup — the re-render did not restore it');
    }
  }
}

/* ── the negative case: no mockup must never borrow another colour ────── */
{
  if (!swatch('hat-embroidered', 'Navy Blue')) {
    fail('the hat has no Navy Blue swatch to click');
  } else {
    await wait(300);
    const hat = photoOf('hat-embroidered');
    if (!hat) {
      fail('the hat card disappeared after a swatch click');
    } else if (!hat.placeholder) {
      fail(`Navy Blue has no mockup but shows ${hat.src.slice(-34)} — a colour must never display another colour's garment`);
    }
  }
  if (swatch('hat-embroidered', 'Black')) {
    await wait(300);
    const hat = photoOf('hat-embroidered');
    if (!hat || !hat.src.includes('hat-black')) {
      fail('switching the hat back to Black did not restore its mockup');
    }
  }
}

try { dom.window.close(); } catch { /* already gone */ }

if (failures.length) {
  console.log('  ✗ photo check — the shop is not showing Printful\'s mockups:');
  for (const message of failures) console.log(`      ${message}`);
  process.exit(1);
}

console.log('  ✓ photo check — mockups survive a colour change, and a missing one stays blank');
process.exit(0);
