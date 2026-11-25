import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const runtime=fs.readFileSync(new URL('../public/store/live.js',import.meta.url),'utf8');
const dom=new JSDOM('<!doctype html><body><div id="host"></div></body>',{url:'https://www.armoniaconnect.com/store/',runScripts:'outside-only'});
const w=dom.window;
const line={key:'p|Black|M',productId:'p',color:'Black',colorName:'Black',size:'M',quantity:1,unitPriceCents:100,lineTotalCents:100};
const bag={lines:[line],count:1,subtotalCents:100,totalCents:100};
let checkoutBodies=[], confirmCalls=0, approve=false;
w.confirm=message=>{assert.match(message,/separate new order.*charge you again/i);confirmCalls++;return approve;};
w.fetch=async(url,options={})=>{
 let data,ok=true;
 if(String(url).endsWith('/bag')) data=bag;
 else if(String(url).endsWith('/shipping')) data={};
 else if(String(url).endsWith('/shipping-quote')) data={fingerprint:'a'.repeat(64),amountCents:100};
 else if(String(url).endsWith('/checkout')) {
  checkoutBodies.push(JSON.parse(options.body));ok=false;
  data=checkoutBodies.length===1?{error:'An earlier order was paid.',code:'paid',previousSessionId:'cs_paid'}:{error:'Please contact us.'};
 } else throw Error('unexpected URL '+url);
 return {ok,status:ok?200:409,headers:{get:()=>null},json:async()=>data};
};
w.eval(runtime+'\nwindow.__test={mountBag,setBag,state};');
const {mountBag,setBag,state}=w.__test;
state.products=[{id:'p',name:'Test',shortName:'Test',type:'custom'}];
setBag(bag);
mountBag(w.document.getElementById('host'),{onClose(){},onShop(){}});
const wait=()=>new Promise(resolve=>setTimeout(resolve,10));
try {
 await wait();
 [...w.document.querySelectorAll('button')].find(b=>b.textContent.includes('Continue to checkout')).click();
 await wait();
 for(const [name,value] of Object.entries({name:'Buyer',line1:'1 Main',city:'Spring',state:'TX',postal_code:'77373'})) {
  const input=w.document.querySelector(`input[name="${name}"]`); input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));
 }
 [...w.document.querySelectorAll('button')].find(b=>b.textContent==='Calculate shipping').click();await wait();
 w.document.querySelector('.checkout-pay').click();await wait();
 assert.equal(checkoutBodies.length,1);
 assert.equal(checkoutBodies[0].restartAfterPaid,undefined);
 assert.match(w.document.querySelector('.checkout-pay').textContent,/separate new order/i);
 w.document.querySelector('.checkout-pay').click();await wait();
 assert.equal(confirmCalls,1);assert.equal(checkoutBodies.length,1,'canceling confirmation never starts another checkout');
 approve=true;w.document.querySelector('.checkout-pay').click();await wait();
 assert.equal(confirmCalls,2);assert.equal(checkoutBodies.length,2);
 assert.equal(checkoutBodies[1].restartAfterPaid,'cs_paid');
 assert.match(w.document.body.textContent,/do not pay again/i);
} finally {w.close();}
console.log('Checkout new-order consent checks passed');
