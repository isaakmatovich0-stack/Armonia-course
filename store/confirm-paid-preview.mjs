// TEMPORARY preview-only read-only check.
import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const { data: rows, error } = await supabase.from('store_orders').select('stripe_session_id,number,status,fulfilment_status,supplier_order_id,fulfilment_error').eq('number', 'AC-FVMXTA');
if (error || rows?.length !== 1) throw new Error('Order not found');
const events = await stripe.events.list({ type: 'checkout.session.completed', limit: 100 });
const event = events.data.find(e => e.data.object.id === rows[0].stripe_session_id);
if (!event) throw new Error('Event not found');
const current = await stripe.events.retrieve(event.id);
console.log('DELIVERY_VERIFY', JSON.stringify({pending_webhooks: current.pending_webhooks, fulfilment_status: rows[0].fulfilment_status, fulfilment_error: rows[0].fulfilment_error}));
