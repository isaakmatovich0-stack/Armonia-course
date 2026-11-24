// TEMPORARY preview-only recovery of the paid windbreaker checkout. It replays
// the genuine Stripe event to the production webhook and may fulfil the order.
// It never creates a payment. Delete immediately after use.
import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const { data: rows, error } = await supabase.from('store_checkout_sessions').select('stripe_session_id,created_at,amount_total,items').eq('created_at', '2026-11-24T21:43:29.011671+00:00');
if (error || rows?.length !== 1 || rows[0].amount_total !== 5379 || rows[0].items?.length !== 1 || rows[0].items[0].productId !== 'windbreaker-embroidered') throw new Error('Checkout does not match the reported order.');
const id = rows[0].stripe_session_id;
const session = await stripe.checkout.sessions.retrieve(id);
if (session.status !== 'complete' || session.payment_status !== 'paid' || session.amount_total !== 5379 || session.metadata?.source !== 'armonia-store') throw new Error('Stripe payment has not been confirmed.');
const events = await stripe.events.list({ type: 'checkout.session.completed', limit: 100 });
const matches = events.data.filter(e => e.data.object.id === id && e.data.object.payment_status === 'paid');
if (matches.length !== 1) throw new Error('Could not identify the original paid event.');
const headersFor = (payload) => ({'content-type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET })});
const url = 'https://www.armoniaconnect.com/api/store/webhook';
const noop = JSON.stringify({ id: 'evt_noop', object: 'event', type: 'diagnostic.noop', data: { object: {} } });
const test = await fetch(url, {method: 'POST', headers: headersFor(noop), body: noop, redirect: 'manual'});
console.log('LIVE_SIGNATURE_CHECK', test.status, (await test.text()).slice(0,200));
if (test.status !== 200) throw new Error('Live webhook not ready; no event replayed.');
const { data: before, error: beforeError } = await supabase.from('store_orders').select('number,fulfilment_status,supplier_order_id,fulfilment_error').eq('stripe_session_id', id);
if (beforeError) throw new Error('Order lookup failed.');
if (before.length) console.log('RECOVERY_ALREADY_RECORDED', JSON.stringify(before));
else {
  // This is the original event retrieved from Stripe, not a fabricated payment.
  const payload = JSON.stringify(matches[0]);
  const response = await fetch(url, {method: 'POST', headers: headersFor(payload), body: payload, redirect: 'manual'});
  console.log('RECOVERY_WEBHOOK', response.status, (await response.text()).slice(0,200));
  if (response.status !== 200) throw new Error('Paid event was not accepted.');
}
const { data: after, error: afterError } = await supabase.from('store_orders').select('number,status,amount_total,amount_shipping,fulfilment_status,supplier_order_id,fulfilment_error').eq('stripe_session_id', id);
if (afterError || after.length !== 1) throw new Error('Order was not recorded.');
console.log('RECOVERED_ORDER', JSON.stringify(after));
