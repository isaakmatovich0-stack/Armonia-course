import {refreshCatalog,priceBag} from '../lib/store/catalog.js';
import {quoteShipping} from '../lib/suppliers/printful.js';
import Stripe from 'stripe';
const cat=await refreshCatalog({force:true});
const recipient={name:'Preview Test',address1:'11025 Westlake Drive',city:'Charlotte',state_code:'NC',country_code:'US',zip:'28273'};
for (const items of [
[{productId:'unisex-classic-tee',color:'Black',size:'M',quantity:1}],
[{productId:'windbreaker-embroidered',color:'Navy',size:'2XL',quantity:1}],
[{productId:'hat-embroidered',color:'Black',size:'ONE SIZE',quantity:1}],
[{productId:'beanie-embroidered',color:'Black',size:'ONE SIZE',quantity:1}],
[{productId:'sticker',color:'White',size:'4″×4″',quantity:1}],
[{productId:'unisex-classic-tee',color:'Black',size:'M',quantity:2},{productId:'hoodie-embroidered',color:'Forest Green',size:'L',quantity:1},{productId:'hat-embroidered',color:'Black',size:'ONE SIZE',quantity:1},{productId:'sticker',color:'White',size:'4″×4″',quantity:1}]
]) {
 try { const bag=priceBag(items);if(bag.lines.length!==items.length)throw new Error('invalid bag'); const q=await quoteShipping(recipient,bag.lines,cat);console.log('SHIPPING_AUDIT',items.map(i=>i.productId).join(','),q.id,q.amountCents); }
 catch(e){console.log('SHIPPING_AUDIT_ERROR',e.message);process.exitCode=1;}
}
