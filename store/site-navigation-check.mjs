import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

// The suite is temporarily unpublished for the store drop. Keep its source,
// admin editor and assets intact, but never advertise it on the other sites.
for (const file of ['public/index.html','public/course/index.html','public/course/dashboard.html','public/store/index.html']) {
  const html = await readFile(file, 'utf8');
  const dom = new JSDOM(html);
  const links = [...dom.window.document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
  assert(!links.some(href => /^\/transcription(?:\/|$)/.test(href)), `${file} exposes the unpublished suite`);
  const own = file === 'public/index.html' ? '/' : file.startsWith('public/course/') ? '/course/' : '/store/';
  for (const target of ['/', '/course/', '/store/']) if (target !== own) assert(links.includes(target), `${file} is missing a link to ${target}`);
  dom.window.close();
}
const generator = await readFile('store/build-store.mjs', 'utf8');
assert(!generator.includes('href="/transcription/"'), 'Store regeneration must not reintroduce the suite link');
const vercel = JSON.parse(await readFile('vercel.json', 'utf8'));
for (const path of ['/transcription', '/transcription/', '/transcription/index.html']) {
  assert(vercel.redirects.some(r => r.source === path && r.destination === '/store/' && r.permanent === false), `${path} must redirect temporarily`);
}
assert((await readFile('public/transcription/index.html', 'utf8')).includes('TRANSCRIPTION SUITE'), 'Suite source must remain for later release');
assert((await readFile('public/admin/transcription-admin.js', 'utf8')).includes('temporarily hidden'), 'Admin should explain the suite is unpublished');
console.log('Public navigation hides the suite; temporary redirects and preserved editor/source passed.');
