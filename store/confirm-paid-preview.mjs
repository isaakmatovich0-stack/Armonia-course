// TEMPORARY preview-only read-only check; no payment or order mutations.
import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const { data: rows, error } = await supabase.from('store_orders').select('stripe_session_id,number,status,amount_total,amount_shipping,fulfilment_status,supplier_order_id,fulfilment_error').eq('number', 'AC-FVMXTA');
if (error || rows?.length !== 1) throw new Error('Order not found');
const order = rows[0];
const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
const events = await stripe.events.list({ type: 'checkout.session.completed', limit: 100 });
const event = events.data.find(e => e.data.object.id === session.id);
const endpoints = await stripe.webhookEndpoints.list({limit: 100});
const response = await fetch(`https://api.printful.com/orders/${order.supplier_order_id.split(':')[1]}`, {headers: {Authorization: `Bearer ${process.env.PRINTFUL_API_TOKEN}`, 'X-PF-Store-Id': process.env.PRINTFUL_STORE_ID}});
const result = await response.json();
if (!response.ok) throw new Error(`Printful lookup failed ${response.status}`);
console.log('RECOVERY_VERIFY', JSON.stringify({number: order.number, payment: session.payment_status, paidCents: session.amount_total, shippingCents: order.amount_shipping, databaseFulfilment: order.fulfilment_status, printfulStatus: result.result?.status, printfulId: result.result?.id, printfulItemCount: result.result?.items?.length, printfulQuantity: result.result?.items?.reduce((n, item) => n + item.quantity, 0), pendingWebhooks: event?.pending_webhooks, endpoint: endpoints.data.filter(e => e.url === 'https://www.armoniaconnect.com/api/store/webhook').map(e => ({status: e.status, events: e.enabled_events}))}));
