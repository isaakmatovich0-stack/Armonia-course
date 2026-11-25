import crypto from 'node:crypto';

const ATTEMPT_TTL = 23 * 60 * 60 * 1000;
const UNKNOWN = 'We could not safely verify an earlier checkout. Please contact us before trying again.';

export class CheckoutGuardError extends Error {
  constructor(code, message, sessionId = null) { super(message); this.code = code; this.sessionId = sessionId; }
}

// Hash all Stripe parameters, not just the shipping quote. Include the random
// cart ID so the digest does not act as a simple hash of an address.
export function checkoutParamsHash(cartId, params) {
  if (!/^cart_[a-f0-9]{32}$/.test(String(cartId || ''))) throw new Error('Checkout identity is unavailable');
  return crypto.createHash('sha256').update(JSON.stringify([cartId, params])).digest('hex');
}
const newAttemptKey = () => crypto.randomBytes(32).toString('hex');

// A single durable slot per cart prevents changed requests from creating a
// second payable session. Replacements require an expired, unpaid session or
// an explicit new-order request after a verified paid and recorded order.
// Compare-and-swap makes concurrent replacements share one new slot.
export async function guardedCheckout({stripe, cartId, params, reserve, save, replace, paidOrderRecorded = async () => false, restartAfterPaid = null, findLegacy, finishLegacy, now = Date.now()}) {
  const paramsHash = checkoutParamsHash(cartId, params);
  let attempt = await reserve(cartId, paramsHash, newAttemptKey());
  for (let i = 0; i < 4; i++) {
    if (!attempt?.created_at || !attempt.attempt_key || !attempt.params_hash) throw new Error('Checkout reservation unavailable');
    if (attempt.legacy_checked !== true) {
      if (!findLegacy || !finishLegacy) throw new Error('Legacy checkout verification unavailable');
      const previousSession = await findLegacy();
      attempt = await finishLegacy(cartId, attempt.attempt_key, previousSession);
      continue;
    }
    if (restartAfterPaid && restartAfterPaid !== attempt.stripe_session_id && restartAfterPaid !== attempt.previous_paid_session_id) {
      throw new CheckoutGuardError('unknown', UNKNOWN);
    }
    // A replay of an explicit new-order request can only recover its original
    // parameters. A stale replay must not replace a different new checkout.
    if (restartAfterPaid && restartAfterPaid === attempt.previous_paid_session_id && attempt.params_hash !== paramsHash) {
      throw new CheckoutGuardError('unknown', UNKNOWN);
    }
    let session;
    if (attempt.stripe_session_id) {
      session = await stripe.checkout.sessions.retrieve(attempt.stripe_session_id);
    } else {
      // Never create with changed parameters under the same key, nor start a
      // new key while an old create could have succeeded but timed out.
      if (attempt.params_hash !== paramsHash) throw new CheckoutGuardError('unknown', UNKNOWN);
      const createdAt = Date.parse(attempt.created_at);
      if (!Number.isFinite(createdAt) || now - createdAt >= ATTEMPT_TTL || createdAt > now + 60_000) throw new CheckoutGuardError('unknown', UNKNOWN);
      session = await stripe.checkout.sessions.create(params, { idempotencyKey: `store-checkout-${attempt.attempt_key}` });
      if (!session?.id) throw new Error('Stripe returned no checkout session');
      await save(attempt.attempt_key, session.id);
      session = await stripe.checkout.sessions.retrieve(session.id);
    }
    if (restartAfterPaid === attempt.stripe_session_id && restartAfterPaid && !(session.status === 'complete' && session.payment_status === 'paid')) {
      throw new CheckoutGuardError('unknown', UNKNOWN);
    }
    if (session.status === 'complete' && session.payment_status === 'paid') {
      // A payment alone is not enough: wait until our order is actually
      // recorded. Never turn processing or an unknown payment into a new order.
      if (!(await paidOrderRecorded(session.id))) throw new CheckoutGuardError('completed', 'Your earlier payment is being checked. Please do not pay again; contact us if your order confirmation does not appear.');
      if (restartAfterPaid === session.id) {
        attempt = await replace(cartId, attempt.attempt_key, session.id, paramsHash, newAttemptKey(), session.id);
        continue;
      }
      throw new CheckoutGuardError('paid', 'An earlier order was paid. Do not pay again unless you intend to place a separate new order.', session.id);
    }
    if (session.status === 'complete' || session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
      throw new CheckoutGuardError('completed', 'This checkout was already completed or is processing. Please check your receipt or contact us before paying again.');
    }
    if (session.status === 'open' && session.payment_status === 'unpaid' && attempt.params_hash === paramsHash && session.url) return session;
    if (session.status === 'open' && session.payment_status === 'unpaid' && attempt.params_hash !== paramsHash) {
      // Stripe atomically decides whether an open session can be expired. If
      // payment completes or expiration is ambiguous, fail closed; do not make
      // a replacement. A retry can retrieve the authoritative status.
      try { session = await stripe.checkout.sessions.expire(session.id); }
      catch { throw new CheckoutGuardError('unknown', UNKNOWN); }
    }
    if (session.status !== 'expired' || session.payment_status !== 'unpaid') throw new CheckoutGuardError('unknown', UNKNOWN);
    attempt = await replace(cartId, attempt.attempt_key, session.id, paramsHash, newAttemptKey(), attempt.previous_paid_session_id || null);
  }
  throw new CheckoutGuardError('unknown', UNKNOWN);
}
