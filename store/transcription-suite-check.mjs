import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = await readFile('public/transcription/index.html', 'utf8');
const script = await readFile('public/transcription/suite.js', 'utf8');
const catalog = JSON.parse(await readFile('public/transcription/catalog.json', 'utf8'));
const errors = [];
const console = new VirtualConsole();
console.on('jsdomError', error => errors.push(error));
const dom = new JSDOM(html, { url: 'https://example.test/transcription/', runScripts: 'outside-only', virtualConsole: console });
const { window } = dom;
window.fetch = async () => ({ ok: true, json: async () => ({config: catalog}) });
window.matchMedia = () => ({ matches: true });
window.HTMLElement.prototype.scrollIntoView = () => {};
window.eval(script);
await new Promise(resolve => setTimeout(resolve, 10));
const $ = selector => window.document.querySelector(selector);
const $$ = selector => [...window.document.querySelectorAll(selector)];
assert.equal($$('.product-card').length, 4);
assert.match($('#results-count').textContent, /4 PIECES/);
$('.filter[data-filter="Vihuela"]').click();
assert.equal($$('.product-card').length, 1);
$('#search').value = 'no matches'; $('#search').dispatchEvent(new window.Event('input', { bubbles: true }));
assert.equal($('#empty-state').hidden, false);
$('#clear-filters').click();
assert.equal($$('.product-card').length, 4);
$('.product-image').click();
assert.equal($('#piece-dialog').hasAttribute('open'), true);
assert.match($('#dialog-content').textContent, /Example listing only/);
assert.equal($$('#dialog-content a').length, 0, 'examples must not offer purchase or preview URLs');
[...$$('#dialog-content button')].find(button => button.textContent.includes('SAVE PIECE')).click();
assert.equal($('.saved-count').textContent, '1');
$('[data-close-dialog]').click();
$('.saved-trigger').click();
assert.match($('#saved-list').textContent, /Your first transcription/);
assert.equal($('#ask-saved').disabled, true, 'sample listings are not treated as real enquiries');
$('#saved-list button').click();
assert.equal($('.saved-count').textContent, '0');
$('[data-close-saved]').click();
$('.menu-toggle').click(); assert.equal($('#mobile-menu').hidden, false);
$('#mobile-menu a').click(); assert.equal($('#mobile-menu').hidden, true);
assert.equal(errors.length, 0, errors.map(e => e.message).join('\n'));
process.stdout.write('Transcription suite interactions passed.\n');
dom.window.close();

// Exercise real-content configuration without making any network requests.
const realCatalog = {
  media: { screeningYoutubeUrl: 'https://youtu.be/abcdefghijk', screeningTitle: 'Performance title', screeningDescription: 'An arrangement in motion.', heroBackgroundVideo: '/transcription/images/example.mp4' },
  featuredId: 'real-one',
  pieces: [{ id: 'real-one', title: 'Real piece', instrument: 'Ensemble', sample: false, description: 'A real description', level: 'Advanced', key: 'G major', duration: '3 minutes', parts: 'Full ensemble', scorePreviewImage: '/transcription/images/preview.png', youtubeUrl: 'https://www.youtube.com/watch?v=abcdefghijk', previewUrl: '', checkoutUrl: '' }],
  news: [{ title: 'Group performance', url: 'https://youtube.com/watch?v=abcdefghijk' }, { title: 'Not YouTube', url: 'https://youtube.com.evil.example/watch?v=abcdefghijk' }]
};
const mediaDom = new JSDOM(html, { url: 'https://example.test/transcription/', runScripts: 'outside-only', virtualConsole: console });
const w = mediaDom.window;
w.fetch = async url => ({ ok: true, json: async () => String(url).includes('transcription-sales') ? ({products:[{piece_id:'real-one',price_cents:1450}]}) : ({config: realCatalog}) });
w.matchMedia = () => ({ matches: false });
w.HTMLElement.prototype.scrollIntoView = () => {};
let plays = 0, pauses = 0;
w.HTMLMediaElement.prototype.play = function () { plays++; return Promise.resolve(); };
w.HTMLMediaElement.prototype.pause = function () { pauses++; };
w.eval(script);
await new Promise(resolve => setTimeout(resolve, 10));
const find = selector => w.document.querySelector(selector);
assert.equal(plays, 1, 'configured background video plays');
find('.motion-toggle').click(); assert.equal(pauses, 1); assert.equal(find('.motion-toggle').getAttribute('aria-pressed'), 'true');
find('.motion-toggle').click(); assert.equal(plays, 2);
assert.equal(find('#screening-title').textContent, 'Performance title');
assert.equal(find('#screening-player iframe'), null, 'YouTube waits for interaction');
find('#screening-player button').click();
assert.match(find('#screening-player iframe').src, /^https:\/\/www\.youtube-nocookie\.com\/embed\/abcdefghijk\?/);
assert.equal(w.document.querySelectorAll('.news-video').length, 1, 'non-YouTube hosts do not embed');
find('.product-image').click();
assert.match(find('#dialog-content').textContent, /Advanced/);
assert.match(find('#dialog-content').textContent, /BUY FOR \$14\.50/);
assert.match(find('#dialog-content').textContent, /PDF is sent/);
assert.match(find('#dialog-content').textContent, /Full ensemble/);
assert(find('.score-preview img'));
find('.piece-video button').click(); assert(find('.piece-video iframe'));
find('[data-close-dialog]').click(); assert.equal(find('#dialog-content iframe'), null, 'closing stops embedded playback');
assert.equal(errors.length, 0, errors.map(e => e.message).join('\n'));
mediaDom.window.close();
process.stdout.write('Transcription media configuration passed.\n');
