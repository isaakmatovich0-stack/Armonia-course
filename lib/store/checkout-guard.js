import crypto from 'node:crypto';

// A cart version and quote identify one checkout even across tabs or refreshes.
// A changed cart, destination, or price is a distinct, intentional attempt.
export function checkoutAttemptKey(cart, fingerprint) {
  if (!cart?.id || !cart.updated_at || !/^[a-f0-9]{64}$/.test(String(fingerprint || ''))) throw new Error('Checkout identity is unavailable');
  return crypto.createHash('sha256').update(JSON.stringify([cart.id, cart.updated_at, fingerprint])).digest('hex');
}

export class CheckoutGuardError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Persist a reservation before contacting Stripe. Stripe idempotency protects
// concurrent requests and unknown outcomes; the durable session ID protects
// retries after Stripe's idempotency keys may have aged out.
export async function guardedCheckout({stripe, key, params, reserve, save, now = Date.now()}) {
  const attempt = await reserve(key);
  if (!attempt?.created_at) throw new Error('Checkout reservation unavailable');
  let session;
  if (attempt.stripe_session_id) {
    session = await stripe.checkout.sessions.retrieve(attempt.stripe_session_id);
  } else {
    const createdAt = Date.parse(attempt.created_at);
    if (!Number.isFinite(createdAt) || now - createdAt >= 23 * 60 * 60 * 1000 || createdAt > now + 60_000) {
      throw new CheckoutGuardError('unknown', 'We could not safely verify an earlier checkout. Please contact us before trying again.');
    }
    session = await stripe.checkout.sessions.create(params, { idempotencyKey: `store-checkout-${key}` });
    if (!session?.id) throw new Error('Stripe returned no checkout session');
    // If persistence fails, return no URL. A retry uses the same Stripe key.
    await save(key, session.id);
    // A cached create response may describe an already paid or expired session.
    session = await stripe.checkout.sessions.retrieve(session.id);
  }
  if (session.status === 'complete' || session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
    throw new CheckoutGuardError('completed', 'This checkout was already completed. Please check your receipt or contact us before paying again.');
  }
  if (session.status === 'expired') {
    throw new CheckoutGuardError('expired', 'This checkout expired. Please return to your bag and change it before starting again.');
  }
  if (session.status !== 'open' || !session.url) throw new CheckoutGuardError('unknown', 'Checkout status could not be verified. Please contact us before trying again.');
  return session;
}
