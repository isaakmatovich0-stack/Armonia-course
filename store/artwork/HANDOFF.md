# What I need from you to finish the shop

Everything below is the complete remaining list. Nothing here needs me to be
involved — if it did, it would be on my side, and there is nothing left on my
side that I can do without what's here.

**Fastest read:** do steps 1–4. That is about an hour of your time and it makes
the shop shippable. Step 5 is the go-live test.

---

## Step 1 — Create the five Printful products (~35 min)

Printful needs a product with a design and a colour/size list before an order can
reference it. This is the only step that produces the variant IDs.

For **cap, tee, hoodie, windbreaker, stickers**:

1. Go to **printful.com** → **Stores** → your store → **Products** → **Add product**
2. Choose the blank (table below)
3. Click **Upload design** and use the file in the table — they are all in
   `store/artwork/` in the repo, so download from there
4. Place the design:
   - cap → **front centre**
   - tee, hoodie → **left chest**
   - windbreaker → **front left chest** *and* **back** (use the back file)
   - stickers → **front**, full bleed
5. Set any retail price (I re-price on the server; it does not matter)
6. Select **every colour and size you want to sell** — each combination becomes
   a variant, and any you skip simply won't be orderable
7. **Submit / confirm** the product

| Shop item | File to upload | Suggested blank |
| --- | --- | --- |
| Signature Cap | `emblem-cap-gold-2000.png` | Yupoong 6245CM or Flexfit 6210 |
| Everyday Tee | `emblem-gold-3000.png` (use `emblem-ink-3000.png` on ivory/sky) | Bella+Canvas 3001 |
| Connection Hoodie | `emblem-gold-3000.png` (ink version on light colours) | Gildan 18500 or B+C 3719 |
| Connection Windbreaker | `emblem-gold-3000.png` front + `windbreaker-back-cream.png` back | any shell that **has a back print area** |
| Connect Sticker Set | `emblem-gold-3000.png` | die-cut vinyl, ~3.2 in |

> **Use the cap file only on the cap.** Its strands are deliberately thickened so
> they survive embroidery. On a tee they would look slightly heavy.

**You do not need to note any IDs.** I read them from the API afterwards.

---

## Step 2 — Add the Printful webhook (3 min)

Tracking reaches customers through this. The token already exists in Vercel.

**Printful → Settings → API → Webhooks → Add webhook**

- **URL:**
  `https://armoniaconnect.com/api/store/supplier-webhook?token=0dff2e23677577d19ab3bb5840532f67`
- **Events:** tick all four —
  `package_shipped`, `order_failed`, `order_canceled`, `package_returned`

---

## Step 3 — PrintKK account and keys (15 min)

The pick set ships from PrintKK because Printful does not make guitar picks.

1. Sign up at **printkk.com**
2. Add a payment method and **top up the wallet** — $20 is plenty, picks are cheap.
   Nothing is charged until an order is actually paid.
3. **Dashboard → Setting → Api Management**
4. Copy the **API key** and the **Secret key** — both, they only work as a pair
5. Enable these permission modules: **General**, **Order**, **Shipment**
   (add **Image** and **Design** if you want me to build the pick design
   rather than uploading it yourself)
6. Send me both keys

---

## Step 4 — Map the variants (~15 min, after steps 1–3 are done)

Once the products exist, tell me and I'll pull the variant IDs and fill this in.
Or do it yourself:

**armoniaconnect.com/admin/ → Products & Prices → each product → Supplier variants**

One line per variant, `colour|size=id`, or `*|*=id` if one variant covers every
colour:

```
ink|M=12345678
ivory|M=12345679
```

The panel at the top of **Store Orders** shows exactly what is still missing —
when it says **"Fulfilment is ready"**, nothing is outstanding.

---

## Step 5 — Rehearsal, then go live (~25 min)

### 5a. Rehearse for free

Ask me to set `PRINTFUL_DRAFT=1`, or add it yourself in
**Vercel → Settings → Environment Variables** and redeploy.

Then buy a tee and a pick set from your own shop with a real card:

- Printful creates a **draft** — nothing is printed, nothing charged
- PrintKK creates an **unpaid** order — no wallet money spent
- The only cost is the card charge, which you refund from the admin in one click

Check **/admin/ → Store Orders** shows `submitted`, then refund the order and
confirm it reports the supplier order cancelled.

**If the PrintKK order fails**, send me the exact error text. Its create/pay
payload is the one thing I inferred rather than verified — their docs are
generated client-side and unreadable to scripts — so a real error message is
what I need to correct it.

### 5b. Go live

1. Set `PRINTFUL_DRAFT` to `0` in Vercel → redeploy
2. Buy one tee and one pick set shipped to your own address
3. When they arrive correct, you're done. Optionally set `PRINTKK_AUTO_PAY=1`
   so pick orders pay themselves.

---

## Step 6 — Five decisions only you can make

These are not tasks, they are answers. The shop works without them, but each one
is currently a gap a customer could notice.

| # | Question | Why it matters |
| --- | --- | --- |
| 1 | **Returns address** — the real US address a customer posts a return to | The shipping page promises 30-day returns and currently says "our fulfilment partner's US facility", which is not an address. This is the most customer-visible gap left. |
| 2 | **Do the prices cover supplier cost?** | A hoodie is roughly $30–35 to make and ship against a $68 price. Worth checking before you advertise. |
| 3 | **Red ring on the back print — yes or no?** | Your reference photo has a dark red ring; I left it out because the palette is gold/ink/ivory/cream/sky. Say the word and I add it. |
| 4 | **Sales tax** in Stripe | Receipts and legal exposure. Check Stripe → Tax is what you want. |
| 5 | **Windbreaker blank** | Confirm the one you pick has a back print area, otherwise the back design is wasted. |

---

## What is already done — no action needed

- **Everything is live.** The shop, the admin, the product editor, the supplier
  integration and the artwork are all deployed to armoniaconnect.com.
- **The fingerprint → pick set fix is live.** Production was still selling
  "The Connect Fingerpicks, Set of 3" until today; it now sells the pick set.
- **Database schema applied.** Products, shipping rules and all eight fulfilment
  columns on orders are in Supabase.
- **`PRINTFUL_API_TOKEN` installed** in Vercel, encrypted, on production and
  preview. It is not in the repo.
- **Webhook and cron secrets generated and installed.**
- **Artwork finished** — four emblem variants and two back prints, all
  transparent and print-sized. The cap file is thickness-corrected for
  embroidery, so no vector original was needed after all.
- **Refunds stop the parcel.** Refunding an order now cancels it at the supplier
  instead of printing it anyway at your cost.
- **A setup checklist** at /admin/ → Store Orders that reads live state and lists
  exactly what is still missing.

## Two things I could not do from here

1. **Verify your Printful token.** This sandbox's network only reaches package
   registries, so I could not call Printful. If the token is wrong it shows as
   "not reachable" in the admin panel immediately.
2. **Confirm the PrintKK order payload.** Same reason, plus their docs are
   client-rendered. Step 5a proves it for free, and an error message is all I
   need to fix it.
