import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const html = readFileSync('public/index.html', 'utf8');
const script = html.match(/<script>\s*\/\/ ── Promotional sale display[\s\S]*?<\/script>/)?.[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
assert.ok(script, 'pricing script found');
async function check(content, status = true) {
  const dom = new JSDOM(html, {runScripts:'outside-only',url:'https://example.com/'});
  dom.window.fetch = async () => ({ok:status, json:async()=>({content})});
  dom.window.eval(script);
  await new Promise(resolve => setTimeout(resolve, 0));
  const cta=dom.window.document.querySelector('.stripe-cta');
  return {href:cta.getAttribute('href'),disabled:cta.getAttribute('aria-disabled'),label:cta.textContent,price:dom.window.document.querySelector('.pricing-amount').textContent};
}
const regular=await check({'sale.enabled':'false'});
assert.match(regular.href,/28EfZg5XZajU6Qx1GhbAs00/); assert.equal(regular.disabled,null);
const sale=await check({'sale.enabled':'true','sale.price':'50','sale.stripe_link':'https://buy.stripe.com/fZuaEWbij63E1wdgBbbAs01'});
assert.match(sale.href,/fZuaEWbij63E1wdgBbbAs01/); assert.equal(sale.disabled,null); assert.equal(sale.price,'50');
for (const state of [await check({},false),await check({'sale.enabled':'true'}),await check({'sale.enabled':'true','sale.price':'50','sale.stripe_link':'https://example.com/'})]) {
 assert.equal(state.href,null); assert.equal(state.disabled,'true'); assert.match(state.label,/unavailable/);
}
console.log('Course pricing safety checks passed');
