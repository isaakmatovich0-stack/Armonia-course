// Regression: a render failure must remain visible, rather than being erased
// by the subsequent refresh of the photo list.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const html = readFileSync('public/admin/index.html', 'utf8');
const start = html.indexOf('    async function openMockupPanel(');
const end = html.indexOf("    document.getElementById('checkPrintfulBtn')", start);
assert(start >= 0 && end > start, 'mockup UI code not found');
const dom = new JSDOM('<button id="mockupsBtn">Find</button><div id="mockupsPanel"></div>', { runScripts: 'outside-only' });
const { window } = dom;
let renderResult = null;
let refreshFails = false;
let fetches = 0;
window.adminFetch = async (_url, options) => {
  if (options?.method === 'POST') {
    if (renderResult instanceof Error) throw renderResult;
    return renderResult;
  }
  fetches++;
  if (refreshFails) throw new Error('refresh failure');
  return { products: [{ id: 'test', name: 'Test', colours: [{ name: 'Black', available: 'https://example.com/black.png' }], blankColours: ['Black'], importable: { Black: 'https://example.com/black.png' } }] };
};
window.eval(`${html.slice(start, end)}\nwindow.testOpenMockupPanel = openMockupPanel; window.testGenerateMockups = generateMockups;`);

await window.testOpenMockupPanel();
renderResult = new Error('Printful 404');
await window.testGenerateMockups('test', window.document.querySelector('[data-generate]'));
assert.match(window.document.querySelector('#mockupResult').textContent, /Printful 404/);
assert.equal(fetches, 1, 'failure must not wipe the error with a refresh');
assert.equal(window.document.querySelector('[data-generate]').disabled, false);
assert.match(window.document.querySelector('[data-generate]').textContent, /Import/);

renderResult = { generated: 0, message: 'No mockups were generated.', failures: [{ colour: 'Black', error: 'Invalid task' }] };
await window.testGenerateMockups('test', window.document.querySelector('[data-generate]'));
assert.match(window.document.querySelector('#mockupResult').textContent, /Black: Invalid task/);

renderResult = { generated: 1, message: 'One generated.', failures: [{ colour: 'Navy', error: 'Failed' }] };
await window.testGenerateMockups('test', window.document.querySelector('[data-generate]'));
assert.match(window.document.querySelector('#mockupResult').textContent, /One generated/);
assert.match(window.document.querySelector('#mockupResult').textContent, /Navy: Failed/);
assert.equal(fetches, 2);

refreshFails = true;
await window.testGenerateMockups('test', window.document.querySelector('[data-generate]'));
assert.match(window.document.querySelector('#mockupsPanel').textContent, /refresh failure/);
assert.match(window.document.querySelector('#mockupResult').textContent, /One generated/);
console.log('  ✓ mockup UI — errors and partial results remain visible');
dom.window.close();
