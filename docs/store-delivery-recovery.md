# Store order delivery recovery

## Scope and rollout

New paid webhook orders opt into an outbox. A Postgres trigger inserts one
receipt job and one supplier job in the *same transaction* as the order. Stripe
redelivery can resume jobs even when the order row already exists. The existing
secret-protected daily supplier sync also sweeps up to 20 jobs per invocation.
No historical orders are backfilled or automatically resent. Historical orders
must be reconciled individually. In particular, AC-58W5D6 has already been
submitted to Printful as 189464396: do not replay or resubmit it.

The additive migration `supabase/schema-store-delivery-recovery.sql` must be
applied before deploying this application. Its opt-in flag defaults to false,
so older application versions do not queue jobs. If rolling back the app after
new orders have opted in, the old app cannot process their jobs: use the admin
order book and reconcile outstanding jobs, and do not blindly resubmit them.
After deployment verify the live version, the cron secret and schedule, and a
safe end-to-end test with Stripe test mode, a mock email provider, and a mock
supplier before relying on it. Do not place a real paid order merely to test.

## Receipt

The receipt payload is snapshotted at order creation and sent with a stable
Resend idempotency key. Provider errors (including returned error objects) are
not treated as success. Retries are delayed by 15 minutes, and Stripe webhook
retries and the daily sweep can resume them. Once an attempt is older than 23
hours without a confirmed outcome, automatic retries stop because provider
idempotency expires; an operator must check the provider before resending.
`done` means Resend accepted the request, **not** that the email reached the
inbox. Missing email or ambiguous outcomes require review.

## Supplier

A leased job prevents parallel automatic submissions. Before the supplier call,
its start is recorded durably; a crash, timeout, supplier error, partially sent
order or failed persistence becomes `review`, not a blind retry. This is
intentional: a supplier may already have created or charged for an order. Check
Printful/PrintKK using the order number and resolve the existing order manually;
do not press submit again until the actual outcome is known. The admin supplier
button is disabled for managed orders. A supplier job interrupted *before* its
start marker can safely resume; a started job with an expired lease is flagged
for review by the sweep. Leases exceed the 300-second function limit. Status
changes through the order database are blocked during an in-flight supplier
submission, and refunded/canceled orders are not newly submitted.

The admin order book shows delivery states for the most recent orders and a
separate global, read-only delivery queue panel. The global panel counts all
managed jobs requiring review, expired leases, and jobs more than 15 minutes
past their next eligible retry; it shows up to ten order numbers per category.
Refresh it during launch. It does not send alerts, monitor legacy orders, check
Stripe webhook failures, or prove that providers delivered. An authenticated
operator may use “Process eligible delivery jobs” to run up to five claimable
jobs at a time; this can submit paid orders and send receipts. Review jobs are
not automatically resent. Check the provider before resolving any uncertain
outcome.
Counts can be zero while the monitor or scheduler itself has failed. The
scheduled sweep is daily on the current Vercel plan, not real-time. The system
cannot guarantee email delivery or detect refunds made directly in Stripe before
the order book is updated. Investigate every uncertain payment or supplier
outcome before asking a customer to retry or creating another order.
