// TEMPORARY: read-only diagnostics for the latest store checkout. Preview builds only.
import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';

if (process.env.VERCEL_ENV !== 'preview') throw new Error('Diagnostics may run only on a preview deployment.');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const { data, error } = await supabase.from('store_checkout_sessions').select('stripe_session_id,created_at,amount_total').order('created_at', { ascending: false }).limit(1);
if (error || !data?.length) throw new Error('Could not find the latest checkout.');
const id = data[0].stripe_session_id;
const session = await stripe.checkout.sessions.retrieve(id, { expand: ['payment_intent'] });
const pi = session.payment_intent;
const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
const events = await stripe.events.list({ types: ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed'], limit: 100 });
const matches = events.data.filter(e => e.data.object.id === id).map(e => ({ type: e.type, pending_webhooks: e.pending_webhooks, created: e.created, payment_status: e.data.object.payment_status }));
const { data: orders, error: orderError } = await supabase.from('store_orders').select('number,status,fulfilment_status,supplier_order_id').eq('stripe_session_id', id);
if (orderError) throw new Error('Could not query order status.');
const ship = pi?.shipping;
console.log('ORDER_DIAGNOSTIC', JSON.stringify({ checkoutCreated: data[0].created_at, recordedAmount: data[0].amount_total, sessionStatus: session.status, paymentStatus: session.payment_status, amount: session.amount_total, intentStatus: pi?.status, addressComplete: Boolean(ship?.name && ship?.address?.line1 && ship?.address?.city && ship?.address?.state && ship?.address?.postal_code && ship?.address?.country === 'US'), metadataKeys: Object.keys(session.metadata || {}), events: matches, endpoints: endpoints.data.map(e => ({ url: e.url, status: e.status, enabled_events: e.enabled_events })), order: orders }));
