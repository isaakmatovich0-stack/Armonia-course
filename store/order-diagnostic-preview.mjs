// TEMPORARY, preview only. Repair the store endpoint to its canonical host;
// test signature verification with a harmless non-payment event. No payment or order is created.
import Stripe from 'stripe';
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only.');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
const oldUrl = 'https://armoniaconnect.com/api/store/webhook';
const newUrl = 'https://www.armoniaconnect.com/api/store/webhook';
const candidates = endpoints.data.filter(e => e.url === oldUrl && e.status === 'enabled');
if (candidates.length !== 1 || endpoints.data.some(e => e.url === newUrl && e.status === 'enabled')) throw new Error('Unexpected endpoint configuration; no changes made.');
const endpoint = candidates[0];
const types = [...new Set([...endpoint.enabled_events, 'checkout.session.async_payment_succeeded'])];
const updated = await stripe.webhookEndpoints.update(endpoint.id, { url: newUrl, enabled_events: types });
console.log('WEBHOOK_UPDATE', JSON.stringify({url: updated.url, status: updated.status, enabled_events: updated.enabled_events}));
const payload = JSON.stringify({ id: 'evt_diagnostic', object: 'event', type: 'diagnostic.noop', data: { object: {} } });
const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
const response = await fetch(newUrl, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
console.log('SAFE_SIGNATURE_TEST', JSON.stringify({status: response.status, body: (await response.text()).slice(0, 200)}));
