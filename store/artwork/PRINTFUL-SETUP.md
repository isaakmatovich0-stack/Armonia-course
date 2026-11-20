# Connecting Printful

Two separate things connect this store to Printful, and they fail in different
ways. Doing them in this order is the difference between "an order went through"
and "an order went through and nobody noticed it failed".

---

## 1. The API token — needed for orders to be placed

Printful → **Settings → API → API tokens → Generate token**

- Name it anything (`Armonia Store`).
- Tick **all scopes**. A token without `orders` cannot place an order, and the
  error you get back is a 403 that looks like a permission bug in our code.
- Copy it immediately. Printful shows it once.

Then Vercel → **Settings → Environment Variables**:

| Name | Value | Environments |
| --- | --- | --- |
| `PRINTFUL_API_TOKEN` | the token | Production **and** Preview |
| `PRINTFUL_STORE_ID` | only if you have more than one store | Production **and** Preview |

Redeploy after saving. Environment variables are baked in at build time, so a
saved variable does nothing until the next deployment.

**Check it worked:** `/admin/` → Store Orders → the panel reads
`Printful — reachable`. If it says the token is missing, the variable is on the
wrong environment.

---

## 2. The webhook — needed for tracking numbers to arrive

This is the part that is easy to get subtly wrong, because **it fails silently**.
Printful will accept a webhook URL that does not work, keep trying, and report
nothing to you. Meanwhile every parcel ships and no customer ever gets a
tracking number.

### What to enter

Printful → **Settings → API → Webhooks → Add webhook**

| Field | Value |
| --- | --- |
| URL | `https://armoniaconnect.com/api/store/supplier-webhook?token=0dff2e23677577d19ab3bb5840532f67` |
| Events | `package_shipped`, `order_failed`, `order_canceled`, `package_returned` |

That long string is your `PRINTFUL_WEBHOOK_TOKEN`. It is already set in Vercel.
The endpoint compares it before doing anything, because the URL is public and
anyone could otherwise POST fake tracking numbers into your orders.

### The four events, and why each one matters

| Event | What we do | What happens if it is missing |
| --- | --- | --- |
| `package_shipped` | writes the tracking number and carrier onto the order | the customer never learns their parcel is coming |
| `order_failed` | marks the order failed and surfaces it in admin | a paid order dies quietly |
| `order_canceled` | same, as cancelled | you keep a completed-looking order that was never made |
| `package_returned` | flags the return | a returned parcel looks delivered forever |

All four are needed. Two is not half as good as four; it is a system where some
failures are visible and others are not, which is worse than none.

### Three things that break it, in order of how often they happen

**1. The token is wrong.** The endpoint answers `{"error":"Method not allowed."}`
to a browser GET regardless of the token — that is deliberate, so a probe cannot
tell a right token from a wrong one. It will not tell you the token is bad. To
check it properly, use Printful's own **Send test** button on the webhook; a
working endpoint answers `200`.

**2. The order was placed before the webhook existed.** Printful only sends
events for orders created after the webhook is added. Orders placed before it
will never produce a tracking number automatically — check those by hand.

**3. The domain does not match.** `armoniaconnect.com` and `www.armoniaconnect.com`
are different hosts to Printful. Use the bare domain, exactly as written above.
A 301 redirect counts as a failure, because Printful does not follow it.

### How to prove it works without shipping anything

1. Place a test order through the real storefront, using `PRINTFUL_DRAFT=1` so
   Printful creates the order as a draft and never charges or prints it.
2. In Printful, open that draft order and confirm it is there.
3. Delete the draft in Printful. A `order_canceled` event fires, our row
   updates, and `/admin/` → Store Orders shows it.
4. If nothing appears, open Vercel → **Logs** → filter `supplier-webhook`. Every
   delivery logs either `webhook ok` or the reason it was rejected: bad token,
   unknown external id, or a signature mismatch.

Do this once. It is the only way to know the token is right, because a wrong
token and a right token are indistinguishable from outside.

---

## 3. After both are connected

1. **Products** — create them in Printful first, then `/admin/` → Products &
   Prices → **Sync colours & sizes from Printful**. That reads your real
   variants and shows a diff before changing anything.
2. **Variants** — **Import variants from Printful**, then assign each Printful
   colour to one of ours. Blanks are refused, on purpose: an unmapped colour
   means a paid order that cannot be made.
3. **Rehearse** — `PRINTFUL_DRAFT=1` in Vercel, buy a tee, confirm the draft
   appears in Printful, refund the card charge, then delete the variable.
4. **Go live** — remove `PRINTFUL_DRAFT`, redeploy, place one real order.
