import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const targets = ['/', '/course/', '/store/', '/transcription/'];
for (const file of ['public/index.html','public/course/index.html','public/course/dashboard.html','public/store/index.html','public/transcription/index.html']) {
  const html=await readFile(file,'utf8');const dom=new JSDOM(html);const hrefs=new Set([...dom.window.document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')));
  const own=file==='public/index.html'?'/':file.startsWith('public/course/')?'/course/':file.startsWith('public/store/')?'/store/':'/transcription/';
  for(const target of targets) if(target!==own) assert(hrefs.has(target),`${file} is missing a link to ${target}`);
  dom.window.close();
}
const source=await readFile('store/build-store.mjs','utf8');
for(const target of ['/','/course/','/transcription/']) assert(source.includes(`href="${target}"`),`Store generator missing ${target}`);
console.log('Home, course, store and transcription navigation links passed.');
