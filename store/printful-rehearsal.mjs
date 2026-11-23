// Temporary preview-only integration rehearsal. It uses an isolated local
// catalogue, real Printful tasks, and deletes its one temporary storage object.
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { JSDOM } from 'jsdom';
const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mockup-rehearsal-'));
const log = (step, details = {}) => console.log('REHEARSAL ' + JSON.stringify({step, ...details}));
let uploaded;
let supabase;
try {
  ({ supabase } = await import('../lib/supabase.js'));
  const { data: rows, error } = await supabase.from('store_products').select('*').in('id', ['unisex-classic-tee', 'hat-embroidered']);
  if (error) throw error;
  assert.equal(rows?.length, 2, 'Expected shirt and frozen hat');
  const shirt = rows.find(r => r.id === 'unisex-classic-tee');
  const old = JSON.stringify(shirt.images || {});
  const html = fs.readFileSync(path.join(root, 'public/admin/index.html'), 'utf8');
  fs.mkdirSync(path.join(temp, '.tmp'));
  fs.writeFileSync(path.join(temp,'.tmp/store-db.json'), JSON.stringify({promos:{},products:Object.fromEntries(rows.map(r=>[r.id,r]))}));
  process.chdir(temp);
  process.env.STORE_LOCAL_DB = '1';
  const { default: handler } = await import('../api/admin/[...slug].js');
  const token = jwt.sign({admin:true}, process.env.SESSION_SECRET, {expiresIn:'10m'});
  const request = async (method, body = {}) => {
    const req = {url:'/api/admin/store-mockups',method,body,headers:{authorization:`Bearer ${token}`}};
    const res = {status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
    await handler(req,res);
    if (res.code !== 200) throw new Error(`Admin ${body.action || method} returned ${res.code}: ${res.data?.error}`);
    if (body.action === 'save') uploaded = res.data.url;
    return res.data;
  };
  const dom = new JSDOM('<button id="mockupsBtn">Find</button><div id="mockupsPanel"></div>', {runScripts:'outside-only'});
  const w = dom.window;
  w.confirm = () => true;
  w.adminFetch = async (_url, options) => request(options ? 'POST' : 'GET', options ? JSON.parse(options.body) : {});
  const start = html.indexOf('    async function openMockupPanel(');
  const end = html.indexOf("    document.getElementById('checkPrintfulBtn')", start);
  assert(start >= 0 && end > start);
  w.eval(`${html.slice(start,end)}\nwindow.rehearsalOpen = openMockupPanel;`);
  await w.rehearsalOpen();
  const box = w.document.querySelector('[data-template-controls="unisex-classic-tee"]');
  const select = box.querySelector('select');
  const matching = [...select.options].filter(o => o.textContent.startsWith('Unisex classic tee ('));
  assert.equal(matching.length,1,'Expected exactly one tee template');
  select.value = matching[0].value;
  assert.match(w.document.querySelector('[data-template-controls="hat-embroidered"]').textContent,/frozen/i);
  box.querySelector('button').click();
  const result = w.document.querySelector('[data-render-result="unisex-classic-tee"]');
  const deadline = Date.now() + 100000;
  while (!result.querySelector('img') && Date.now() < deadline && !/Could not render|no usable/i.test(result.textContent)) await new Promise(r=>setTimeout(r,1000));
  const cards = [...result.querySelectorAll('img')];
  assert(cards.length, `No photos: ${result.textContent}`);
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(temp,'.tmp/store-db.json'))).products[shirt.id].images || {}), old, 'Rendering changed the local catalogue');
  log('render', {photos:cards.length, captions:[...result.querySelectorAll('span')].map(x=>x.textContent), hatFrozen:true});
  const save = result.querySelector('button');
  save.click();
  while (!uploaded && Date.now() < deadline && !/Could not save/i.test(result.textContent)) await new Promise(r=>setTimeout(r,500));
  assert(uploaded, `Save failed: ${result.textContent}`);
  const response = await fetch(uploaded, {redirect:'error'});
  assert.equal(response.status,200);
  const images = JSON.parse(fs.readFileSync(path.join(temp,'.tmp/store-db.json'))).products[shirt.id].images;
  assert(Object.values(images).includes(uploaded),'Local catalogue did not record image');
  log('save', {publicStatus:response.status, contentType:response.headers.get('content-type'), localCatalogueUpdated:true});
  w.close();
} catch (err) {
  log('error', {message:String(err.message).slice(0,500)});
} finally {
  if (uploaded && supabase) {
    const key = new URL(uploaded).pathname.split('/site-images/')[1];
    const {error} = await supabase.storage.from('site-images').remove([decodeURIComponent(key)]);
    log('cleanup', {removed:!error,error:error?.message});
  }
  process.chdir(root);
  fs.rmSync(temp, {recursive:true,force:true});
}
