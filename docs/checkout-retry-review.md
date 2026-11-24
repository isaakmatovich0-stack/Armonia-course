# Store checkout retry work — not ready for release

The branch uses one checkout slot per cart, with a digest of all Stripe session
parameters. For changed parameters, it expires the previous open Stripe session
before trying to create a replacement; if expiration or creation is uncertain,
it fails closed. An atomic compare-and-swap selects one replacement slot when
requests race. A paid and recorded order can only be followed by a separate
purchase after explicit customer confirmation. Processing sessions are not
replaced. A conditional cart-version check protects a new bag from late payment
webhooks. The confirmation page no longer claims a pending payment is confirmed
or promises a receipt has been sent. None of these changes are in production yet.

Automated tests use simulated Stripe and storage to cover simultaneous retries,
changes, timeouts, expired and completed sessions, and duplicate supplier
responses. An earlier unpaid preview exercised the *previous*, less complete
same-quote guard against Stripe and Supabase; it does not validate the current
cart-scoped version. No test establishes that double payment is impossible.

Before release:

- Review the explicit new-order flow under real concurrency and failure. It
  requires a paid Stripe session, a recorded order and customer confirmation;
  changing the bag or address by itself does not authorize another purchase.
- Exercise database uniqueness and compare-and-swap with real parallel requests
  and Stripe test-mode sessions, including crashes before and after expiration,
  create, persistence, and retrieval. The required additive columns and index
  are installed on the otherwise unused production retry table. A rolled-back
  temporary-table SQL probe verified uniqueness and compare-and-swap statements;
  it did not test PostgREST or Stripe.
- Account for old open production sessions created before release and for the
  payment/webhook race. Independently created browser carts cannot be reliably
  identified as duplicates, so no guarantee is possible across browsers.
- Make paid-order email and supplier delivery recoverable after process failure.
  Currently, failed email is only logged and an interruption after inserting an
  order can skip automatic supplier submission. Printful external IDs and
  unique Stripe session IDs help deduplicate, but do not prove delivery.
- Verify customer-facing messages, plan reconciliation of unknown outcomes older
  than Stripe's idempotency window, and validate the rollout without charging a
  real payment or placing a supplier order.

If payment status is uncertain, investigate it before asking anyone to retry.
