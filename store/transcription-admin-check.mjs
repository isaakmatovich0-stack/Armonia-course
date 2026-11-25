import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import jwt from 'jsonwebtoken';
import { validateTranscriptionConfig } from '../lib/transcription-config.js';
import { supabase } from '../lib/supabase.js';
import adminHandler from '../api/admin/[...slug].js';
import publicHandler from '../api/[...slug].js';

const catalog = JSON.parse(await fs.readFile('public/transcription/catalog.json', 'utf8'));
assert.equal(validateTranscriptionConfig(catalog), null);
assert.match(validateTranscriptionConfig({...catalog, pieces:[{id:'a', title:'X', sample:false, cover:'javascript:alert(1)'}]}), /HTTPS/);
assert.match(validateTranscriptionConfig({...catalog, pieces:[{id:'a', title:'X', sample:false, youtubeUrl:'https://youtube.com.evil.example/watch?v=abcdefghijk'}]}), /YouTube/);
assert.match(validateTranscriptionConfig({...catalog, pieces:[{id:'a', title:'X', sample:false}, {id:'a', title:'X', sample:false}]}), /unique/);

process.env.SESSION_SECRET = 'test-secret';
let stored = null;
const originalFrom = supabase.from.bind(supabase);
supabase.from = table => {
  assert.equal(table, 'site_content');
  let operation, value, matchRevision;
  const builder = {
    select() { return this; },
    eq(key, val) { if (key === 'updated_at') matchRevision = val; return this; },
    insert(row) { operation='insert'; value=row; return this; },
    update(row) { operation='update'; value=row; return this; },
    async maybeSingle() {
      if (operation === 'insert') { if (stored) return {data:null,error:{code:'23505'}}; stored = {...value}; return {data:{updated_at:stored.updated_at},error:null}; }
      if (operation === 'update') { if (!stored || stored.updated_at !== matchRevision) return {data:null,error:null}; stored={...stored,...value}; return {data:{updated_at:stored.updated_at},error:null}; }
      return {data:stored, error:null};
    }
  }; return builder;
};
const token = jwt.sign({admin:true}, process.env.SESSION_SECRET);
async function request(method, body, auth = true) {
  const res = {setHeader(){},status(code){this.code=code;return this},json(data){this.data=data;return this}};
  await adminHandler({url:'/api/admin/transcription-content',method,headers:auth ? {authorization:`Bearer ${token}`} : {},body},res); return res;
}
try {
  assert.equal((await request('GET', null, false)).code, 401);
  assert.equal((await request('GET')).data.config, null);
  assert.equal((await request('PUT', {config:catalog,revision:null}, false)).code, 401);
  const first = await request('PUT', {config:catalog,revision:null}); assert.equal(first.code, 200);
  const revision = first.data.revision;
  const edited = structuredClone(catalog); edited.pieces[0].title = 'Updated';
  const second = await request('PUT', {config:edited,revision}); assert.equal(second.code, 200); assert.notEqual(second.data.revision, revision);
  assert.equal((await request('PUT', {config:catalog,revision})).code, 409);
  assert.equal((await request('PUT', {config:catalog,revision:null})).code, 409);
  assert.equal((await request('GET')).data.config.pieces[0].title, 'Updated');
  process.env.VERCEL = '1';
  const publicRes = {setHeader(){},status(code){this.code=code;return this},json(data){this.data=data;return this}};
  await publicHandler({url:'/api/transcription-content',method:'GET',headers:{}},publicRes);
  assert.equal(publicRes.code,200); assert.equal(publicRes.data.config.pieces[0].title,'Updated');
  const wrongMethod = {setHeader(){},status(code){this.code=code;return this},json(data){this.data=data;return this}};
  await publicHandler({url:'/api/transcription-content',method:'PUT',headers:{}},wrongMethod); assert.equal(wrongMethod.code,405);
  delete process.env.VERCEL;
} finally { supabase.from = originalFrom; }

const html = await fs.readFile('public/admin/index.html','utf8');
const script = await fs.readFile('public/admin/transcription-admin.js','utf8');
const errors = []; const console = new VirtualConsole(); console.on('jsdomError', e => errors.push(e));
const dom = new JSDOM(html,{url:'https://example.test/admin/',runScripts:'outside-only',virtualConsole:console});
const w=dom.window; w.confirm=()=>true; w.fetch=async()=>({ok:true,json:async()=>structuredClone(catalog)}); w.eval(script);
let saved;
const api=async (url, options) => { if (url.endsWith('transcription-content') && !options) return {config:null,revision:null}; if (options?.method==='PUT') { saved=JSON.parse(options.body); return {ok:true,revision:'v2'}; } throw new Error('Unexpected call'); };
w.transcriptionAdmin.open(api); await new Promise(resolve=>setTimeout(resolve,10));
const root=w.document.querySelector('#transcriptionAdmin');
assert.match(root.textContent,/Transcription products \(4\)/);
root.querySelector('[data-action="add-piece"]').click();
const newTitle=root.querySelector('[data-group="pieces"][data-index="4"][data-key="title"]'); newTitle.value='A new piece'; newTitle.dispatchEvent(new w.Event('input',{bubbles:true}));
const newCategory=root.querySelector('[data-group="pieces"][data-index="4"][data-key="instrument"]'); newCategory.value='Violin';newCategory.dispatchEvent(new w.Event('input',{bubbles:true}));
root.querySelector('[data-action="delete-piece"][data-index="0"]').click();
const hero=root.querySelector('[data-group="media"][data-key="heroBackgroundImage"]'); hero.value='https://example.test/cover.jpg';hero.dispatchEvent(new w.Event('input',{bubbles:true}));
root.querySelector('[data-action="save"]').click();await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(saved.config.pieces.length,4); assert.equal(saved.config.pieces.at(-1).title,'A new piece'); assert.equal(saved.config.media.heroBackgroundImage,'https://example.test/cover.jpg'); assert.equal(saved.config.featuredId,''); assert.equal(saved.revision,null); assert.match(root.querySelector('.ts-status').textContent,/Saved/);
assert.equal(errors.length,0,errors.map(e=>e.message).join('\n'));
dom.window.close();
process.stdout.write('Transcription admin, validation and stale-write checks passed.\n');
