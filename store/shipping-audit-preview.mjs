import {refreshCatalog,priceBag} from '../lib/store/catalog.js';
import {quoteShipping} from '../lib/suppliers/printful.js';
import Stripe from 'stripe';
const cat=await refreshCatalog({force:true});
const recipient={name:'Preview Test',address1:'11025 Westlake Drive',city:'Charlotte',state_code:'NC',country_code:'US',zip:'28273'};
for (const items of [
[{productId:'unisex-classic-tee',color:'Black',size:'M',quantity:1}],
[{productId:'windbreaker-embroidered',color:'Navy',size:'2XL',quantity:1}],
[{productId:'unisex-classic-tee',color:'Black',size:'M',quantity:2},{productId:'hoodie-embroidered',color:'Forest Green',size:'L',quantity:1},{productId:'hat-embroidered',color:'Black',size:'ONE SIZE',quantity:1},{productId:'sticker',color:'White',size:'4″×4″',quantity:1}]
]) {
 try { const bag=priceBag(items);if(bag.lines.length!==items.length)throw new Error('invalid bag'); const q=await quoteShipping(recipient,bag.lines,cat);console.log('SHIPPING_AUDIT',items.map(i=>i.productId).join(','),q.id,q.amountCents); }
 catch(e){console.log('SHIPPING_AUDIT_ERROR',e.message);process.exitCode=1;}
}
// Create an unpaid temporary session solely to validate Stripe's parameter compatibility; expire it immediately.
if(process.env.STRIPE_SECRET_KEY){let stripe=new Stripe(process.env.STRIPE_SECRET_KEY,{apiVersion:'2024-06-20'});try {const session=await stripe.checkout.sessions.create({mode:'payment',payment_method_types:['card'],line_items:[{price_data:{currency:'usd',unit_amount:100,product_data:{name:'Unpaid integration test'}},quantity:1},{price_data:{currency:'usd',unit_amount:450,product_data:{name:'Standard shipping'}},quantity:1}],allow_promotion_codes:false,customer_creation:'always',payment_intent_data:{shipping:{name:'Preview Test',address:{line1:'11025 Westlake Drive',city:'Charlotte',state:'NC',postal_code:'28273',country:'US'}}},success_url:'https://www.armoniaconnect.com/store/?checkout=success',cancel_url:'https://www.armoniaconnect.com/store/?checkout=cancelled'}); await stripe.checkout.sessions.expire(session.id);console.log('STRIPE_AUDIT unpaid session created and expired');}catch(e){console.log('STRIPE_AUDIT_ERROR',e.message);process.exitCode=1;}}
