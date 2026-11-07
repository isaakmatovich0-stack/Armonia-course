# Artwork & setup checklist

Everything still needed to take the store live, in the order it unblocks things.
Each item says **You** or **Me** — nothing on this list needs both of us at once.

Files in this folder are production assets, committed so they cannot be lost.

| File | Size | What it is |
| --- | --- | --- |
| `emblem-gold-3000.png` | 3000 × 3000, transparent | Emblem in brand gold `#DDB465` |
| `emblem-ink-3000.png` | 3000 × 3000, transparent | Emblem in ink `#17282C`, for light garments |
| `windbreaker-back-gold.png` | 3148 × 2614, transparent | Back print: emblem + AR-MO-NI-A |

Both emblems were produced from your `LOGO GOLD.png` (emblem was 829 × 1254 px
inside a navy background), cropped, background keyed out to transparency, and
upscaled. Edges were checked against white, ivory, sky and ink backgrounds.

---

## ✅ Already done — nothing needed from you

- Emblem separated from the navy background at print resolution
- Ink version for light garments
- Windbreaker back design (**a proposal** — see 1c)

---

## Step 1 — Artwork

### 1a. Do you have the original vector? **You**

The PNG I have is a good raster, but vector is better, and this decides the cap.

Ask yourself: was the emblem made in Illustrator, Inkscape, Figma, Canva, or by a
designer? If **yes**, get the `.ai`, `.svg`, `.eps` or `.pdf`.

- **If you can get it** → send it. I export every size from it and this whole section is finished.
- **If it only ever existed as a flat PNG** → skip to 1b, and accept a simplified cap emblem.

**Why it matters:** the emblem's three curved strands are ~6–10 px wide in the
source. On a cap (max ~3 in wide) that is **0.5–0.9 mm of thread**. Embroidery
needs ~1 mm or the strands merge into a blob. On a tee at 12 in that same stroke
is 2–4 mm and prints beautifully. So the **cap** is the only product that needs
either a vector or a redraw.

### 1b. A simplified emblem for the cap only **Me, after 1a**

If no vector exists, I redraw the emblem for embroidery with the strands at a
thread-safe weight — same silhouette, fewer, thicker strands. You approve it or
we drop to the emblem without the strands. Nothing for you to do until I send it.

### 1c. Approve or replace the back print **You**

`windbreaker-back-gold.png` is my reading of "statement typography across the
shoulders" — the emblem plus AR-MO-NI-A broken into syllables, CONNECT beneath.
Open it and answer one of:

- **Good** → I map it as-is
- **Different wording** → tell me the exact text and I redo it
- **Use my file** → send the design

### 1d. Confirm you own the emblem **You**

If a designer or an AI tool made it, confirm you have the right to print and sell
it. If a person made it, get the source file from them — that also solves 1a.

### 1e. Sticker cut path **Me**

Die-cut stickers need a cut line. I will use the emblem silhouette, inset by
~1.5 mm. No input needed unless you want a different sticker shape.

---

## Step 2 — Printful account and products

### 2a. Get the API token **You** — 2 minutes

1. Sign in at **printful.com**
2. Click your avatar, bottom-left → **Settings**
3. Left menu → **API**
4. **Generate token** (or copy the existing one)
5. Name it `Armonia Store`, tick every scope, **Generate**
6. Copy the token — it is shown once

Send me the token. **Do not paste it into a file in the repo**; I put it in Vercel.

### 2b. Create the products **You** — ~30 min

Printful needs a product (a "sync product") per garment, each with a design and a
colour/size list — that is what produces the variant IDs.

For each of: **cap, tee, hoodie, windbreaker, stickers**

1. **Stores → your store → Products → Add product**
2. Pick the blank (see the style choices below)
3. **Upload design** → use the PNG from this folder (`emblem-gold-3000.png`, or the
   ink version for light colours)
4. Place it: cap = front centre; tee/hoodie = left chest; windbreaker = front
   left chest **and** back (upload `windbreaker-back-gold.png` for the back)
5. Set your retail price (does not matter to me — I re-price on the server)
6. Select **every colour and size you want to sell** — each combination becomes a variant
7. **Submit / confirm**

**Blank suggestions** (cheapest sensible defaults — you can change any of them):

| Shop item | Suggested blank | Why |
| --- | --- | --- |
| Signature Cap | Yupoong 6245CM / Flexfit 6210 | the standard embroidered cap |
| Everyday Tee | Bella+Canvas 3001 | soft, true-to-size, the POD default |
| Connection Hoodie | Gildan 18500 or B+C 3719 | heavyweight, holds embroidery |
| Windbreaker | any packable nylon shell with front + back print areas | confirm it has a **back** print area before ordering |
| Sticker Set | any die-cut vinyl sticker, 3.2 in | matches your copy |

### 2c. Read the variant IDs **Me**

You do **not** need to hunt for IDs. Once 2a and 2b are done I call Printful's
API, list every variant, and fill the mapping in the admin myself. You just
confirm the list matches what you expected.

### 2d. Register the webhook **You** — 3 minutes

So tracking numbers reach customers automatically.

1. **Settings → API → Webhooks → Add webhook**
2. **URL:** `https://armoniaconnect.com/api/store/supplier-webhook?token=YOUR_WEBHOOK_TOKEN`
   (I give you `YOUR_WEBHOOK_TOKEN` — a random string I generate)
3. **Events:** `package_shipped`, `order_failed`, `order_canceled`
4. Save

---

## Step 3 — PrintKK account (the pick set)

PrintKK is less work than Printful because there is no separate product setup.

### 3a. Create the account and top up **You**

1. Sign up at **printkk.com**
2. Add a payment method and **top up the wallet** with a small amount (~$20 is
   plenty for testing; picks are cheap)
3. Note: orders are paid from this wallet. Nothing is charged until an order is
   actually paid.

### 3b. Get the two keys **You** — 2 minutes

1. **Dashboard → Setting → Api Management**
2. Apply for / copy the **API key** and the **Secret key**
3. Enable permission modules: **General**, **Order**, **Shipment**, plus
   **Image** and **Design** if you want me to create the design

Send both. They only work as a pair — the secret signs every request.

### 3c. Create the design **Me**

With the keys I upload `emblem-gold-3000.png`, create a design on the pick set,
and read back the `designVariantId` per colour. I show you the mockup to approve
before any order can be paid.

---

## Step 4 — Vercel environment variables

**You** — 10 minutes, at **vercel.com → your project → Settings → Environment
Variables**. Add each, all environments, then **Redeploy**.

| Name | Value | Where it comes from |
| --- | --- | --- |
| `PRINTFUL_API_TOKEN` | `...` | 2a |
| `PRINTFUL_WEBHOOK_TOKEN` | random string | I generate it, you paste |
| `PRINTKK_API_KEY` | `...` | 3b |
| `PRINTKK_SECRET_KEY` | `...` | 3b |
| `CRON_SECRET` | random string | I generate it, you paste |
| `PRINTFUL_DRAFT` | `1` | **keep on until step 5 passes** |

Leave `PRINTKK_AUTO_PAY` unset for now — that means no order can spend wallet
money without a human clicking pay.

---

## Step 5 — Rehearsal, then live

### 5a. Rehearsal **You** — 20 minutes

With `PRINTFUL_DRAFT=1`, buy a tee and a pick set from your own store with a real
card.

- Printful creates a **draft** — nothing is produced or charged
- PrintKK creates an **unpaid** order — no wallet money spent
- Total cost: the card charge, which you refund from the admin in one click

Then check **/admin/ → Store Orders** reads `submitted`. Refund the order and
confirm it says the supplier order was cancelled.

### 5b. Go live **You**

1. Set `PRINTFUL_DRAFT` to `0` in Vercel → Redeploy
2. Buy one tee and one pick set to your own address for real
3. When they arrive correct, turn on PrintKK auto-pay if you want hands-off picks

---

## Step 6 — Things only you can answer

| # | Question | Why it blocks |
| --- | --- | --- |
| 1 | **Returns address** — a real US address customers can post to | the shipping page promises returns; it currently has no address after it |
| 2 | **Do the prices still work** once you see supplier costs? | a hoodie costs roughly $30–35 to make and ship, against a $68 price |
| 3 | **Cap shipping** — caps often ship separately from tees | affects whether a cap + tee order has one tracking number or two |
| 4 | **Windbreaker blank** — confirm it has a back print area | the back design is wasted otherwise |
| 5 | **Sales tax setup** in Stripe/Tax | receipts and legal exposure |

---

## The shortest path

1a (do you have the vector?) → 2a + 2b (Printful token and products) →
3b (PrintKK keys) → 4 (env vars) → 5a (rehearsal).

Item **1a** is one question and it changes the cap artwork. Everything else can
run in parallel with it.
