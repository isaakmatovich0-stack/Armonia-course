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
changes, timeouts, expired and completed sessions, explicit new-order consent,
and duplicate supplier responses. A Vercel preview tested parallel reservation,
save and compare-and-swap operations against real Supabase with simulated Stripe.
A separate preview used real Stripe in live mode without payment details: one
lost creation response recovered the same session, retries reused it, and a
changed checkout expired it before creating another. Both diagnostic sessions
were expired unpaid and the test reservation was removed. These checks do not
prove that double payment is impossible, and the paid/new-order path was mocked.

Before release:

- Review the explicit new-order flow under real concurrency and failure. It
  requires a paid Stripe session, a recorded order and customer confirmation;
  changing the bag or address by itself does not authorize another purchase.
- Exercise additional failure and true concurrent creation cases against Stripe
  test mode, including crashes before and after expiration, create, persistence,
  and retrieval. The required additive columns and index are installed on the
  otherwise unused production retry table; no live checkout code uses them yet.
- Account for old open production sessions created before release and for the
  payment/webhook race. The existing session audit table had four rows marked
  open, two created in the last 48 hours; their true Stripe statuses were not
  checked in this review. The table is not guaranteed complete on production.
  Avoid a rollout that can open a new session while an old one remains payable.
  Independently created browser carts cannot be reliably identified as
  duplicates, so no guarantee is possible across browsers.
- Make paid-order email and supplier delivery recoverable after process failure.
  Currently, failed email is only logged and an interruption after inserting an
  order can skip automatic supplier submission. Printful external IDs and
  unique Stripe session IDs help deduplicate, but do not prove delivery.
- Verify customer-facing messages, plan reconciliation of unknown outcomes older
  than Stripe's idempotency window, and validate the rollout without charging a
  real payment or placing a supplier order.

If payment status is uncertain, investigate it before asking anyone to retry.
