import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
const root = process.cwd();
// Test the actual pixel function without requiring a browser canvas.
const context = {}; vm.runInNewContext(fs.readFileSync('public/store/photo-cutout.js','utf8'),context);
const cut = context.__armoniaCutoutPixels;
const image = (width,height) => {const data = new Uint8ClampedArray(width*height*4);for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=255;data[i+3]=255;}return data;};
const data = image(20,20);
for(let y=4;y<16;y++) for(let x=4;x<16;x++){const i=(y*20+x)*4;data[i]=20;data[i+1]=30;data[i+2]=35;}
// White print detail is enclosed by the garment and must remain intact.
let detail=(10*20+10)*4;data[detail]=data[detail+1]=data[detail+2]=255;
assert(cut(data,20,20));assert.equal(data[3],0);assert.equal(data[detail+3],255);assert.equal(data[(8*20+8)*4+3],255);
const scene=image(20,20);scene[0]=0;assert.equal(cut(scene,20,20),false);assert.equal(scene[3],255);
const empty=image(20,20);assert.equal(cut(empty,20,20),false);assert.equal(empty[3],255);
const page = new JSDOM(fs.readFileSync('public/store/index.html','utf8'));
assert.equal(page.window.document.querySelector('.suite-ribbon a').getAttribute('href'),'/transcription/');
const suite = new JSDOM(fs.readFileSync('public/transcription/index.html','utf8'));
assert.match(suite.window.document.body.textContent,/transcription suite/i);
assert.equal(suite.window.document.querySelector('.back').getAttribute('href'),'/store/');
page.window.close();suite.window.close();

// Test catalog-only proxy, including rejection of arbitrary and untrusted URLs.
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'armonia-photo-'));
process.env.STORE_LOCAL_DB='1';
process.chdir(temp);fs.mkdirSync('store');fs.mkdirSync('.tmp');fs.copyFileSync(path.join(root,'store/catalog.json'),'store/catalog.json');
fs.writeFileSync('.tmp/store-db.json',JSON.stringify({promos:{},products:{shirt:{id:'shirt',name:'Shirt',type:'tee',colors:['Black','Navy'],sizes:['M'],price_cents:2000,images:{Black:'https://files.cdn.printful.com/test.png',Navy:'https://evil.example/test.png'},back_images:{Black:'https://files.cdn.printful.com/back.png'},in_stock:true}}}));
let urls=[];
globalThis.fetch=async url=>{urls.push(String(url));return new Response(Buffer.from([137,80,78,71,13,10,26,10]),{status:200,headers:{'content-type':'image/png'}})};
try {
 const {default:handler}=await import(path.join(root,'api/store/[...slug].js'));
 const request=async url=>{const res={headers:{},setHeader(k,v){this.headers[k]=v},status(c){this.code=c;return this},json(d){this.data=d;return this},send(d){this.data=d;return this}};await handler({url,method:'GET',headers:{}},res);return res};
 const ok=await request('/api/store/photo?product=shirt&colour=Black&url=https://evil.example/');
 assert.equal(ok.code,200);assert.equal(ok.headers['Content-Type'],'image/png');assert.equal(urls[0],'https://files.cdn.printful.com/test.png');
 assert.equal((await request('/api/store/photo?product=shirt&colour=Navy')).code,404);
 assert.equal((await request('/api/store/photo?product=shirt&colour=Unknown')).code,404);
 assert.equal((await request('/api/store/photo?product=shirt&colour=Black&side=back')).code,200);
 assert.equal(urls[1],'https://files.cdn.printful.com/back.png');
 assert.equal((await request('/api/store/photo?product=shirt&colour=Navy&side=back')).code,404);
 assert.equal((await request('/api/store/photo?product=shirt&colour=Black&side=other')).code,400);
 assert.equal(urls.length,2);
} finally {process.chdir(root);fs.rmSync(temp,{recursive:true,force:true});}
console.log('  ✓ visuals — safe cutout, suite navigation, and catalog-bound image proxy');
