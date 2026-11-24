// TEMPORARY preview-only read-only diagnosis. No charges, refunds or orders.
import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
const {data, error} = await supabase.from('store_orders').select('stripe_session_id,number,supplier_order_id').eq('number','AC-FVMXTA');
if (error || data?.length !== 1 || data[0].supplier_order_id !== 'printful:189438251') throw new Error('Order not found');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY,{apiVersion:'2024-06-20'});
const session = await stripe.checkout.sessions.retrieve(data[0].stripe_session_id, {expand:['payment_intent.latest_charge']});
const intent = session.payment_intent;
const charge = intent?.latest_charge;
const charges = await stripe.charges.list({payment_intent:intent.id,limit:100});
const fp = charge?.payment_method_details?.card?.fingerprint;
const recent = await stripe.charges.list({created: {gte: session.created - 86400}, limit:100});
const sameCard = fp ? recent.data.filter(c => c.payment_method_details?.card?.fingerprint === fp).map(c => ({amount:c.amount,status:c.status,created:c.created, sameOrder:c.payment_intent===intent.id, refunded:c.refunded})) : null;
const response = await fetch('https://api.printful.com/orders/189438251',{headers:{Authorization:`Bearer ${process.env.PRINTFUL_API_TOKEN}`,'X-PF-Store-Id':process.env.PRINTFUL_STORE_ID}});
const json = await response.json();
if (!response.ok || json.result?.external_id !== 'AC-FVMXTA') throw new Error('Printful order lookup failed');
console.log('CHARGE_REVIEW',JSON.stringify({sessionStatus:session.payment_status,sessionAmount:session.amount_total, intentStatus:intent.status, orderCharges:charges.data.map(c=>({amount:c.amount,status:c.status,paid:c.paid,refunded:c.refunded})),sameCardRecent:sameCard,sameCardResultsComplete:!recent.has_more, printfulStatus:json.result.status, printfulError:json.result.error, printfulCosts:json.result.costs}));
