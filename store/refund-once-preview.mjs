// One authorized $53.79 refund for AC-FVMXTA, without changing fulfillment.
// Temporary preview-only action. Fail closed on any mismatch or existing refund.
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
const token = process.env.STRIPE_SECRET_KEY;
if (!token || !(token.startsWith('sk_live_') || token.startsWith('rk_live_'))) throw new Error('Live Stripe key unavailable');
const headers = {Authorization: `Bearer ${token}`};
async function get(path) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {headers});
  if (!r.ok) throw new Error(`Stripe read failed: ${r.status}`);
  return r.json();
}
const endpoints = await get('webhook_endpoints?limit=100');
if (endpoints.has_more) throw new Error('Too many Stripe endpoints to inspect');
const risk = endpoints.data.filter(e => e.status === 'enabled' && e.enabled_events.some(x => x === '*' || x === 'charge.refunded' || x.startsWith('refund.') || x.startsWith('charge.refund.')));
if (risk.length) throw new Error('Refund-related Stripe webhook exists; stopping to avoid affecting fulfillment');
const session = await get('checkout/sessions/cs_live_bg9Dte1ilwuqABbZT3UJ2YM3N1ZuZd3mx2IEgrIiyfguf5zPo5v1PSXbGC');
if (session.id !== 'cs_live_bg9Dte1ilwuqABbZT3UJ2YM3N1ZuZd3mx2IEgrIiyfguf5zPo5v1PSXbGC' || session.amount_total !== 5379 || session.currency !== 'usd' || session.payment_status !== 'paid' || !session.livemode || !session.payment_intent) throw new Error('Unexpected checkout session');
const charges = await get(`charges?payment_intent=${encodeURIComponent(session.payment_intent)}&limit=100`);
if (charges.has_more || charges.data.length !== 1) throw new Error('Unexpected charge count');
const charge = charges.data[0];
if (charge.amount !== 5379 || charge.amount_captured !== 5379 || charge.currency !== 'usd' || charge.status !== 'succeeded' || !charge.paid || !charge.livemode) throw new Error('Unexpected charge');
const refunds = await get(`refunds?charge=${encodeURIComponent(charge.id)}&limit=100`);
if (refunds.has_more) throw new Error('Too many refunds');
if (refunds.data.length || charge.amount_refunded !== 0) {
  console.log('REFUND_RESULT', JSON.stringify({action: 'none_existing_refund', amount_refunded: charge.amount_refunded, refunds: refunds.data.map(x => ({id: x.id, amount: x.amount, status: x.status}))}));
  process.exit(0);
}
const body = new URLSearchParams({charge: charge.id, amount: '5379', reason: 'requested_by_customer'});
const response = await fetch('https://api.stripe.com/v1/refunds', {method: 'POST', headers: {...headers, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': 'armonia-AC-FVMXTA-customer-requested-refund-5379-v1'}, body});
const result = await response.json();
if (!response.ok) {
  console.log('REFUND_RESULT', JSON.stringify({action: 'refund_request_failed', http: response.status, code: result.error?.code, type: result.error?.type}));
  process.exitCode = 1;
} else {
  const verified = await get(`refunds/${encodeURIComponent(result.id)}`);
  console.log('REFUND_RESULT', JSON.stringify({action: 'refund_requested', id: verified.id, amount: verified.amount, currency: verified.currency, status: verified.status}));
}
