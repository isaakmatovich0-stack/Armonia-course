// One-time restoration of the existing advertised $100 course option. No purchases.
import Stripe from 'stripe';
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const links = await stripe.paymentLinks.list({limit:100});
if(links.has_more) throw new Error('Link list incomplete');
const matching=links.data.filter(l=>l.url==='https://buy.stripe.com/28EfZg5XZajU6Qx1GhbAs00');
if(matching.length!==1 || !matching[0].livemode) throw new Error('Unexpected regular link');
const link=matching[0];
const items=await stripe.paymentLinks.listLineItems(link.id,{limit:100,expand:['data.price.product']});
const item=items.data[0];
if(items.has_more || items.data.length!==1 || item.quantity!==1 || item.price?.unit_amount!==10000 || item.price.currency!=='usd' || item.price.type!=='one_time' || !item.price.product?.active) throw new Error('Regular link does not match advertised course price');
if(!item.price.active) await stripe.prices.update(item.price.id,{active:true},{idempotencyKey:'armonia-restore-regular-course-price-2026'});
if(!link.active) await stripe.paymentLinks.update(link.id,{active:true},{idempotencyKey:'armonia-restore-regular-course-link-2026'});
const [updatedPrice,updatedLink]=await Promise.all([stripe.prices.retrieve(item.price.id),stripe.paymentLinks.retrieve(link.id)]);
console.log('REGULAR_COURSE_RESTORED',JSON.stringify({priceActive:updatedPrice.active,linkActive:updatedLink.active,amount:updatedPrice.unit_amount,currency:updatedPrice.currency}));
if(!updatedPrice.active || !updatedLink.active) throw new Error('Restore verification failed');
