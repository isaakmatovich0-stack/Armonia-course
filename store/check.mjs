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

console.log(failures ? `\n${failures} problem${failures === 1 ? '' : 's'} found.` : '\nAll good.');
process.exit(failures ? 1 : 0);
