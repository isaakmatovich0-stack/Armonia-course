# Getting Printful from zero to taking orders

Follow this in order. Each step says what you will see if it worked, and what
Printful's error actually means if it did not.

---

## Step 0 — A store must exist

Printful stores almost everything inside a "store": products belong to one,
orders are placed against one. An account with no store answers
`This endpoint requires store_id!` — which sounds like a token problem and is
not. An invalid token returns `401`, never `400`.

1. Printful → **Stores** (left sidebar)
2. **Add store**
3. Find **Manual order platform / API** → **Connect via API**
   - It is usually below the platform logos; scroll, or look under "Other"
   - **Do not pick Shopify, Etsy, WooCommerce, Wix** — Printful withholds API
     access for third-party tools on platform-linked stores
4. Name it `Armonia Connect` → save

**You do not need to find the store ID.** With exactly one store the app
discovers it automatically. Only if you have two or more must you set
`PRINTFUL_STORE_ID` — and the error message will name them for you.

---

## Step 1 — Environment variables in Vercel

Vercel → **Settings → Environment Variables**. Tick Production *and* Preview for
each. **Redeploy after saving** — variables are baked in at build time.

| Name | Value | Needed? |
| --- | --- | --- |
| `PRINTFUL_API_TOKEN` | your API token | yes |
| `PRINTFUL_WEBHOOK_TOKEN` | already set | yes |
| `PRINTFUL_STORE_ID` | a number | only with 2+ stores |
| `PRINTFUL_DRAFT` | `1` | only during the rehearsal |

Check it: `/admin/` → Store Orders → the panel reads
`✓ Printful — reachable` and, if it is still empty, `no store in the account yet`.

---

## Step 2 — Choose your blanks

This is the one decision that cannot be automated, and it is genuinely yours:
which physical garment gets printed on.

Open `store/printful-products.json` and fill `catalogVariantId` for each product.
`catalogVariantId` is the **catalog variant**, not a store variant — it is the
size/colour combination of a blank.

How to find one:

1. Go to https://developers.printful.com/docs/#tag/Catalog-API
2. `GET /products` — lists blanks with a `type` and model, e.g.
   "Bella + Canvas 3001 Unisex Short Sleeve T-Shirt"
3. `GET /products/{id}` — lists every variant with `id`, `size` and `color`
4. Pick the one you want and copy its numeric `id`

Or, faster, use Printful's own store UI to make **one** product by hand, then
open it and read the variant id off the URL. Either is fine.

**Why this is blank on purpose:** a guessed variant id prints a real garment —
just not the one you chose. A blank id creates nothing and says so. That is the
right way round.

Put the same number in `catalogProductId` if you want it recorded.

---

## Step 3 — Create the products in Printful

`/admin/` → **Products & Prices** → **Create products in Printful**

You will see, per product, which artwork goes where:

```
The Everyday Tee
  front ← emblem-gold.png (694 KB)
  back  ← back-cream.png (734 KB)
```

Press **Create N product(s) in Printful**. Nothing is charged; this only adds
products to your store. Products already there are skipped, so it is safe to
press twice.

**If it says "Cannot create yet"** — the blank id is still blank. Go back to
Step 2.

---

## Step 4 — Replace the storefront catalogue

The store on the website was designed before any real products existed: names,
colours and prices that described a collection nobody had ordered. Printful now
has the real ones, so this replaces rather than merges.

`/admin/` → **Products & Prices** → **Replace catalogue from Printful**

The preview lists exactly what will be created and what will be deleted.
Names, colours, sizes, prices and photos all come from Printful; prices are
Printful's retail prices. Nothing is written until you press the button, and the
button sends back the fingerprint of the plan you were shown — if the store
changed in between, the apply is refused rather than half-done.

Two things worth knowing:

- **Products arrive out of stock.** A sync that puts new stock on sale without
  anyone deciding to is a surprise, not a feature. Switch them on when ready.
- **Deletion only happens after the replacements land.** If creating them fails,
  the old rows stay.

## Step 4b — Match colours to yours



Creating a product in Printful does **not** tell our storefront what colours it
comes in. Do this next, in this order:

1. **Products & Prices → Sync colours & sizes from Printful**
   Only needed if you later add variants in Printful without replacing the catalogue. Shows a diff before writing anything.
   - **Red box** — a colour or size you sell that Printful cannot make. It will
     be removed, because a colour you cannot fulfil is a paid order you cannot
     ship. Read the list before applying.
   - **Gold box** — a Printful colour with no swatch. Set a hex later; until
     then it shows a neutral swatch rather than a made-up colour.
   - **Orange box** — on sale but not in Printful, so unfulfillable.
2. Press **Apply these changes**
3. **Import variants from Printful** — assign each Printful colour to one of
   yours (Printful's "Black" is our "ink"). Blank rows are refused on purpose:
   a half-filled map looks finished and fails at the first real order.

---

## Step 5 — Webhook

`/admin/` → Store Orders → **Register webhook with Printful**

Printful has no webhook screen in its dashboard; it is API-only, and this button
does the API call. It replaces any existing config — Printful allows one.

---

## Step 6 — Rehearse before going live

1. Set `PRINTFUL_DRAFT=1` in Vercel, redeploy
2. Buy a tee through the real storefront
3. Confirm it appears in Printful as a **draft** — not charged, not printed
4. Delete the draft in Printful → fires `order_canceled` → your admin shows it
5. Refund the card charge in Stripe
6. Remove `PRINTFUL_DRAFT`, redeploy

Only then is the store safe to sell from.

---

## Step 6b — Seasonal decorations

`/admin/` → Products & Prices → **Seasonal decorations** → tick, save.

One switch turns on every festive surface: the falling snow in the hero, the two
fir trees at the foot of the stage, and the one-line banner. It is saved to the
database (`store_settings.decorations_on`), so it takes effect on the live site
within a minute — no deploy, no code change, and it can be turned off in
December from a phone.

The banner message is the box beside it; leave it empty for the default line.

Two things worth knowing:

- **Reduced motion wins.** A visitor whose device asks for less animation gets
  the trees and the banner but no falling snow. That is not a bug.
- **It cannot be baked in.** If a seasonal flag ever reappears inside
  `public/store/index.html`, `npm run check` fails — a baked flag means the admin
  switch has stopped controlling that surface.

### After the season, or after switching it off

Nothing to do. Decorations default to **off**: a database that has never been
told what season it is in shows a plain shop.

### The first time

The setting needs its columns:

```sql
-- run once, in Supabase → SQL editor
\i supabase/schema-v16.sql
```

(or paste the contents of that file). Until it is run, the admin shows a notice
saying so and the store shows no decorations — it does not break.

---

## Error reference

| Message | Actually means |
| --- | --- |
| `This endpoint requires store_id!` | No store in the account, or several and none pinned. Not a token problem. |
| `Printful 401` | The token really is wrong or missing from that environment. |
| `no store in the account yet` | Step 0 not done. |
| `has N stores, so PRINTFUL_STORE_ID must be set` | Good news — set it to one of the ids listed. |
| `no catalogVariantId` | Step 2 not done for that product. |
| `Could not read your Printful store` | Usually scopes: the token needs orders and products. |
| `the page sells N product(s) not in the catalogue` | `npm run check` caught the page advertising deleted products. Run `npm run sync:catalog -- --from <rows.json>`, then `npm run build:store`. |
| `price drift — X page $N vs catalogue $M` | The built page is older than the catalogue. `npm run build:store`. |
| `the decorations columns do not exist yet` | Run `supabase/schema-v16.sql`. |
| `the page bakes a seasonal flag` | A season flag got written into the generated page. Remove it from the slug allow-list in `store/build-store.mjs`; the switch must stay live. |
