import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM,VirtualConsole } from 'jsdom';
const script=await readFile('public/admin/transcription-sales.js','utf8');
const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',err=>errors.push(err));
const dom=new JSDOM('<div id="transcriptionSales"></div>',{url:'https://example.test/admin/',runScripts:'outside-only',virtualConsole:vc});
const w=dom.window;w.HTMLElement.prototype.scrollIntoView=()=>{};w.eval(script);
let saved,uploaded;
const api=async (url,options)=>{
  if(url.endsWith('/transcription-sales')&&!options)return {products:[],orders:[],attention:[],checkoutEnabled:false};
  if(url.endsWith('/transcription-content'))return {config:{pieces:[{id:'piece-1',title:'Example real piece',sample:false}]}};
  if(url.endsWith('/transcription-upload-pdf')){uploaded=JSON.parse(options.body);return {assetPath:'piece-1/01234567-89ab-4cde-8f01-23456789abcd.pdf'};}
  if(url.endsWith('/transcription-sales')&&options?.method==='PUT'){saved=JSON.parse(options.body);return {ok:true};}
  throw new Error('unexpected API call');
};
w.transcriptionSalesAdmin.open(api); await new Promise(resolve=>setTimeout(resolve,10));
const root=w.document.querySelector('#transcriptionSales');
assert.match(root.textContent,/globally OFF/);
root.querySelector('[data-price]').value='14.50';root.querySelector('[data-enabled]').checked=true;
const file=new w.File(['%PDF-1.7\nMock'],'preview.pdf',{type:'application/pdf'});
Object.defineProperty(root.querySelector('[data-pdf]'),'files',{value:[file]});
root.querySelector('[data-sale-save]').click();await new Promise(resolve=>setTimeout(resolve,30));
assert.equal(uploaded.pieceId,'piece-1');assert.match(uploaded.pdfBase64,/^data:application\/pdf;base64,/);
assert.deepEqual(saved,{pieceId:'piece-1',priceCents:1450,assetPath:'piece-1/01234567-89ab-4cde-8f01-23456789abcd.pdf',enabled:true});
assert.match(root.querySelector('.ts-sales-status').textContent,/saved/i);assert.equal(errors.length,0);
dom.window.close();process.stdout.write('Digital sales admin controls passed (mocked storage and API).\n');
