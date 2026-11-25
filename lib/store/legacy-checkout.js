import { CheckoutGuardError } from './checkout-guard.js';

// Before allowing a cart from the pre-guard era to create its first guarded
// session, inspect Stripe directly: the old audit table could silently miss
// writes. Scanning is deliberately bounded; failures or ambiguity fail closed.
export async function findLegacyCheckout(stripe, cartId, cartCreatedAt) {
  const created = Date.parse(cartCreatedAt);
  if (!Number.isFinite(created)) throw new CheckoutGuardError('unknown', 'We could not verify an earlier checkout. Please contact us before paying.');
  let cursor, examined=0, relevant=null;
  for (;;) {
    const page=await stripe.checkout.sessions.list({limit:100,created:{gte:Math.max(0,Math.floor(created/1000)-60)}, ...(cursor ? {starting_after:cursor} : {})});
    if (!Array.isArray(page.data)) throw new Error('Stripe checkout scan failed');
    for (const s of page.data) {
      if (++examined > 2000) throw new CheckoutGuardError('unknown', 'We could not verify an earlier checkout. Please contact us before paying.');
      if (s.metadata?.cart_id !== cartId) continue;
      if (s.status === 'expired' && s.payment_status === 'unpaid') continue;
      if (!s.id || relevant) throw new CheckoutGuardError('unknown', 'This bag has multiple earlier checkouts. Please contact us before paying.');
      relevant=s.id;
    }
    if (!page.has_more) return relevant;
    const last=page.data.at(-1)?.id;
    if (!last || last === cursor) throw new Error('Stripe checkout scan incomplete');
    cursor=last;
  }
}
