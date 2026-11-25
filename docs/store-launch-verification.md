# Store launch verification and rollback

## Isolation is mandatory

The existing Vercel preview environment shares production Supabase, Stripe,
Printful and Resend credentials. It is **not a sandbox**. Never send simulated
paid events or run load generators against that preview or production. A
signed event can produce a real supplier order and charge. Do not replay or
resubmit existing order AC-58W5D6 (Printful 189464396).

`store/recovery-end-to-end-check.mjs` exercises the production-mode webhook,
worker, email and supplier adapters using a locally generated Stripe signature
and mocked database and providers. It tests duplicate delivery, an uncertain
supplier confirmation, receipt retry and 200 fake orders at concurrency 25.
It cannot validate Stripe test mode, PostgREST/SQL locking, a deployed runtime,
provider credentials or capacity. `store/order-flow-simulation-check.mjs`
separately exercises the simulated checkout flow. Neither test moves money.

For a deployed end-to-end test, provision an isolated database, use Stripe test
mode with its own signing secret and endpoint, and make Printful and Resend
mock adapters the only reachable supplier/email endpoints. Block live credentials
and production network targets; verify isolation before sending any test event.
Use Stripe test cards there only. Verify the same order, receipt job and supplier
job persist, a duplicate webhook doesn't duplicate effects, a failed receipt
retries, an uncertain supplier result moves to review, and a restart recovers a
claimed job. Inspect SQL leases and RLS against a real isolated Postgres.

## Production rollout gates

1. Confirm migration is installed, current production SHA, deployment and
   rollback permissions, and that no historical jobs will be replayed. Pause new
   guarded checkout if needed for cutover; never replay an existing order.
2. Assign a named operator to watch Stripe event failures, order records,
   supplier status and email events throughout the launch. The admin queue
   panel is read-only and is not an alerting system. Its global counts cover
   managed jobs only, not legacy orders or unrecorded webhook failures. There is
   currently no automatic alert for a stopped scheduler or a failed webhook.
3. Arrange a frequent authenticated sweep and independent alerting, validate
   missed-run detection, and verify provider rate limits. The configured Vercel
   cron is once daily and sweeps at most 20 jobs. Stripe retry is supplemental,
   not an adequate standalone scheduler. Do not assume raising batch size alone
   solves latency or serverless timeouts.
4. Verify every offered variant with Printful: mapping existence is not proof
   of stock, artwork, configuration or available capacity. Do not invent IDs.
5. Define expected peak concurrency, request mix, error/latency limits,
   budgets and rollback thresholds. Load-test a separate environment with
   representative database and provider behavior; coordinate any real provider
   testing. A follower count is not the same as simultaneous visitors. Never
   load-test production checkout or the live suppliers.
6. Only then deploy with someone available to monitor; verify promoted SHA,
   webhook destination and non-mutating health checks. A fresh live order is
   not proven by a locally signed event. If an appropriately authorized real
   purchase eventually occurs, trace the one payment, one supplier submission,
   and the actual email and shipping events without replaying or reordering.

If an incident occurs, pause **new** checkout via the guard. Keep receiving
webhooks for already paid sessions. Check provider records before attempting
any recovery. Rolling back the application leaves managed jobs unprocessed by
older code: reconcile them explicitly and do not blindly resend.
