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

/* The hero stays the existing black hat even though featuredId is a tee and
   live catalogue data contains a different hat image. The CTA opens the hat;
   other colours remain available in the product dialog, not misrepresented
   by the frozen image. */
{
  const hero = w.document.querySelector('.floating-cap img');
  if (!hero || hero.getAttribute('src') !== '/store/images/cap-hero-ink.webp') fail('hero did not retain the frozen black hat');
  if (!hero || !hero.getAttribute('alt').includes('Hat')) fail('hero is not labelled as the hat');
  const controls = w.document.querySelectorAll('.hero-swatch-row button');
  if (controls.length !== 1 || !controls[0].getAttribute('aria-label').includes('Black')) fail('hero offers a colour without a frozen photo');
  if (w.document.querySelector('path[d^="M50 0C50 33"]') || w.document.querySelector('.announcement-separator')?.textContent.includes('✦')) fail('a decorative star is still present');
  for (const selector of ['.headline-spark', '.original-stamp>svg:last-child', '.marquee-group>svg', '.newsletter-graphic>svg', '.footer-signoff>svg', '.announcement-separator svg']) {
    if (!w.document.querySelector(`${selector} image[href="/store/images/brand-logo.webp"]`)) fail(`brand mark missing at ${selector}`);
  }
  const heroButton = w.document.querySelector('.floating-cap');
  heroButton.click(); await wait(300);
  const modal = w.document.querySelector('[role="dialog"][data-editor-scope="product-hat-embroidered"]');
  if (!modal) fail('hero did not open the hat product');
  const angled = modal?.querySelector('[aria-label="Angled product view"]');
  if (!angled || angled.querySelector('img')?.getAttribute('src') !== '/store/images/cap-hero-ink.webp') fail('black hat detail thumbnail is broken');
  else { angled.click(); await wait(150); if (modal.querySelector('.detail-view')?.getAttribute('src') !== '/store/images/cap-hero-ink.webp') fail('black hat detail view is broken'); }
  const close = w.document.querySelector('[aria-label="Close dialog"]');
  if (close) close.click();
  await wait(200);
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
