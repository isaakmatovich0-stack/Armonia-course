# Store checkout retry and delivery recovery review

The branch uses one checkout slot per cart, with a digest of all Stripe session
parameters. For changed parameters, it expires the previous open Stripe session
before trying to create a replacement; if expiration or creation is uncertain,
it fails closed. An atomic compare-and-swap selects one replacement slot when
requests race. A paid and recorded order can only be followed by a separate
purchase after explicit customer confirmation. Processing sessions are not
replaced. A conditional cart-version check protects a new bag from late payment
webhooks. The confirmation page no longer claims a pending payment is confirmed
or promises a receipt has been sent. The checkout guard was deployed and activated in PR #34. The delivery-recovery work below is a separate, not-yet-deployed change.

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
  production retry table; the guarded checkout now uses them.
- Roll out with checkout paused until the old deployment's requests have
  drained. Pre-existing carts are scanned against Stripe before their first
  guarded session. During the read-only review one legacy store session was
  still open and unpaid, one was paid, and two audit rows were actually expired.
  No session was changed. Review the cutover scan and test it against real
  PostgREST before activating checkout. Multiple relevant sessions fail closed.
  Independent browser carts cannot reliably be identified as duplicates.
- Deploy and verify durable receipt and supplier recovery. The implementation
  and migration are described in `docs/store-delivery-recovery.md`. Existing
  orders are excluded from automatic replay and must be reconciled separately.
- Verify customer-facing messages, plan reconciliation of unknown outcomes older
  than Stripe's idempotency window, and validate the rollout without charging a
  real payment or placing a supplier order.

If payment status is uncertain, investigate it before asking anyone to retry.

## Cutover procedure

1. Apply the additive guard schema with `activated_at` NULL. This does not
   affect the old live checkout, which does not read the setting.
2. Deploy the guarded code. Verify production is promoted and that the
   checkout endpoint returns the temporary-unavailability response.
3. Wait longer than the previous deployment's maximum function duration (300
   seconds) after promotion, with a safety margin, for old requests to drain.
   Existing Stripe checkout pages remain usable and are not expired by rollout.
4. Set `activated_at` to the database's current time. New carts are guarded;
   older carts first scan Stripe before a new session is made. Reopening a
   checkout for an old cart may expire its prior open session, but only when a
   customer initiates the replacement and Stripe confirms it is unpaid.
5. Verify the live endpoint is unpaused using non-purchasing checks. Monitor
   errors. Setting `activated_at` to NULL pauses new guarded checkout if a
   problem is discovered; do not replay payments or supplier submissions.

This transition does not fix store receipt retry or supplier-delivery recovery,
and cannot prevent duplicate purchases initiated from independent browsers.
