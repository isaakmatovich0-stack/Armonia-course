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

**Printful has no webhook screen.** There is no Settings → Webhooks page. A
webhook is an API-only setting (`POST /webhooks`), which is why every guide that
says "go to the dashboard and add a webhook URL" is describing something you
cannot do. This is the single most misleading thing about setting Printful up.

So the store registers it for you.

### The one-click way

1. `/admin/` → **Store Orders**
2. The supplier panel shows either `✓ Webhook registered` or `✗ Webhook not registered`
3. If it is red, press **Register webhook with Printful**
4. It goes green, and shows the events and the URL it registered

That is the whole step. It calls `POST /webhooks` with our URL and the four
events, from the server, using the API token.

### What it registers

```
https://armoniaconnect.com/api/store/supplier-webhook?token=<PRINTFUL_WEBHOOK_TOKEN>
```

Events: `package_shipped`, `order_failed`, `order_canceled`, `package_returned`

The token is `PRINTFUL_WEBHOOK_TOKEN`, already set in Vercel. It is in the URL
because Printful has no signing secret, so the URL is the only thing that can
prove an event is really from Printful. Treat it as disposable: it is stored in
Printful's UI and appears in their logs, so if it leaks, change the variable,
redeploy, and register again.

### Three things that break it

**1. Only one webhook exists per store.** Registering replaces whatever was
there — including one you set up by hand for another purpose. The admin warns
before doing it. If you had a webhook for something else, it is gone.

**2. The URL must be the production host.** The registration pins
`armoniaconnect.com`, deliberately ignoring whatever host the admin happened to
be open on. A preview deployment's URL works until that deployment is replaced,
then stops delivering events with no error.

**3. Orders placed before registration never produce events.** Printful only
sends events for orders created after the webhook exists. Anything older must be
tracked by hand.

### How to prove it works, without shipping anything

1. Set `PRINTFUL_DRAFT=1` in Vercel, redeploy.
2. Buy a tee through the real storefront.
3. In Printful, confirm the order exists as a **draft** — it is not charged and
   not printed.
4. Delete the draft in Printful. That fires `order_canceled`.
5. `/admin/` → Store Orders should show the order as cancelled, not fulfilled.
6. If nothing changes: Vercel → **Logs** → filter `supplier-webhook`. Every
   delivery logs either success or the exact rejection reason.

That exercise is the only way to know the token in the URL is right, because a
wrong token and a right one look identical from outside.

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
