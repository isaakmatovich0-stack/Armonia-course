# Transcription PDF sales: setup and safety

This implementation is **off by default**. No real scores or prices are supplied. It has been tested with mocks only and is not a guarantee of payment, email acceptance, inbox delivery, or system capacity. Do not enable production checkout until the prerequisites and an isolated end-to-end test below are complete.

## What it does

An admin can save a real suite piece, then use **Transcription Suite → Manage PDF sales** to set its USD price, upload a PDF up to 3 MB, and enable the individual product. Uploaded PDFs go into the `transcription-purchases` private bucket with an immutable unique path; public catalog APIs do not expose those paths. Only a non-example piece with an enabled price and file is offered for sale. Checkout retrieves the price, title and file path server-side and snapshots them into a durable order; each checkout attempt uses a client UUID and Stripe idempotency key. Payment uses Stripe Checkout, one transcription per checkout.

The existing course webhook accepts signed Stripe events and recognizes metadata `source=armonia-transcription`; only a paid session matching its stored order ID, Stripe session, USD amount and currency can trigger delivery. A private PDF is fetched and sent as an email attachment through Resend, using a stable idempotency key. Provider acceptance is not proof of inbox delivery. Files attached to email can be forwarded and cannot be revoked.

## Required setup before activating

1. Apply `supabase/schema-transcription-sales.sql` to the correct database. Confirm the `transcription-purchases` bucket actually exists and is **private**, has appropriate file restrictions, and that no existing broad `storage.objects` policies expose its contents. The migration deliberately does not change an existing bucket or any storage policies. Confirm tables have RLS enabled and no client access. Do not store paid PDFs in `public/`, the public `site-images` bucket, or the public `site_content` table.
2. Configure the correct Stripe webhook destination for `/api/webhook`, with the signing secret used by that deployment and the `checkout.session.completed` and `checkout.session.async_payment_succeeded` events enabled. Confirm this independently with Stripe; the code cannot verify the destination configuration. Do not replace or disturb existing course/store webhook destinations or replay existing customer orders.
3. Confirm the Stripe, Resend, verified sender and webhook secrets are correctly configured for the environment. `TRANSCRIPTION_CHECKOUT_ENABLED` must remain unset or `false` while testing. For actual sales this switch must be `true`, and the individual product must be enabled. Products cannot be activated merely by adding a price label.
4. Test using **isolated Stripe test-mode credentials, an isolated Supabase project/bucket and a test Resend setup**, not production integrations. Exercise successful payment and receipt, unpaid/delayed events, repeated signed events, failed file retrieval, provider failure, process crash, refund/chargeback handling and concurrent requests. Verify the attachment arrives and matches the purchased file, and that course/merch checkouts remain unaffected. The repository tests do not prove any of these live integrations.
5. Implement an abuse/rate-limiting strategy for public checkout creation and a reliable alert/reconciliation process for unpaid/missing webhook events and stalled/failed deliveries before production activation. These are not provided by this change. Manual dashboard checks alone are not a reliable unattended recovery system.
6. Have the owner supply authorized scores, accurate pricing, appropriate rights/licensing and customer terms. Review applicable tax, refunds and chargeback policy. Test a real product and email workflow under the owner's supervision before advertising sales. Never use real customer orders for test replays.

## Delivery operations

The admin shows the 100 oldest `sending`/`review` orders and the 50 most recent orders. There are **no automated alerts or background retries**. An order can remain `awaiting_payment` if Stripe's webhook never arrives. A `sending` order can be an in-flight request or a crashed worker; `review` means the outcome requires investigation. Check Stripe's payment status and Resend's provider records and timing before taking any action. Never blindly resend or charge again: an email may already have been accepted even if its response was lost. Manually deliver an attachment only after confirming payment, recipient and prior send status; keep an audit record and reconcile the order with an authorized operator. The current admin does not offer automated retry or a mark-resolved action.

A score is snapshot by immutable storage path, not by current product settings; do not delete old PDF objects while any past order may need fulfillment. Replacing a PDF does not remove the old object. Removing a public listing does not erase existing orders. Changing a price does not modify an already-started checkout. The Stripe success return is not proof of payment; delivery relies on the signed webhook. If a customer reports no email, check spam, Stripe and provider records before deciding what to do.

## Current release status

The code and schema in this branch are a **disabled implementation**, not yet deployed or activated. Do not tell customers that sales and delivery are live until the setup, testing and monitoring steps above are complete.
