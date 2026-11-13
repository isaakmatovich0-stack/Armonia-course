# Artwork & setup checklist

State of play, and what is genuinely still outstanding. Each item says **You** or
**Me** — nothing waits on both of us at once.

## Done — nothing needed from you

| File | Size | What it is |
| --- | --- | --- |
| `emblem-gold-3000.png` | 3000 × 3000, transparent | Emblem, brand gold `#DDB465` |
| `emblem-ink-3000.png` | 3000 × 3000, transparent | Emblem in ink `#17282C`, for light garments |
| `emblem-cream-3000.png` | content, transparent | Emblem in cream `#F6F3EB`, for black garments |
| `emblem-cap-gold-2000.png` | 2000 × 2000, transparent | **Cap only** — strands thickened to survive embroidery |
| `windbreaker-back-cream.png` | 4500 × 5400, transparent | Back print for dark garments |
| `windbreaker-back-ink.png` | 4500 × 5400, transparent | Back print for light garments |

All derived from your `LOGO GOLD.png`: the emblem was 829 × 1254 px inside a navy
background, cropped, keyed out to true transparency, then scaled. Edges checked
against ink, ivory and sky.

### The cap question is answered

You said there was no vector, so this was measured instead of guessed.

- A cap embroidery area is ~63 mm wide, and the source emblem was 841 px across,
  so **1 px ≈ 0.075 mm**.
- The three curved strands are 6–10 px → **0.45–0.75 mm of thread**. Embroidery
  needs ~1 mm, so they would have merged.
- `emblem-cap-gold-2000.png` grows each edge by 4 px, taking the thinnest strand
  to ~14 px ≈ **1.05 mm**. Simulated at the 63-stitch grid a real machine uses:
  all four strand bands stay separate.

So the cap needs **no redraw from you** — use the cap file for caps and the plain
emblem everywhere else. Printful digitises embroidery from a PNG; you do not need
to supply a `.dst` or vector.

### The back print matches your reference

Your photo showed a large emblem centred high, with the wordmark directly
underneath. That is what the two back files are: emblem at ~42 % of print height,
`ARMONIA CONNECT` letterspaced beneath it.

**One deliberate departure:** the reference badge has a dark red ring. I left it
out. The Armonia palette in this project is gold, ink, ivory, cream and sky —
there is no red anywhere, and a red ring would introduce a sixth colour on a
garment that otherwise uses two. Say the word and I will add it in
`#8C2D0B` (the palette's orange-red) or a true crimson.

---

## Still yours to do

### 1. Create the Printful products — ~30 min

For **cap, tee, hoodie, windbreaker, stickers**:

1. printful.com → **Stores → Products → Add product**
2. Pick the blank (see the table below)
3. **Upload design** — use the file from the table
4. Place it: cap = front centre; tee/hoodie = left chest; windbreaker = front left
   chest **and** back (back file for the back placement)
5. Select **every colour and size** you want to sell — each becomes a variant
6. Confirm / submit

| Shop item | File to upload | Suggested blank |
| --- | --- | --- |
| Signature Cap | `emblem-cap-gold-2000.png` | Yupoong 6245CM / Flexfit 6210 |
| Everyday Tee | `emblem-gold-3000.png` (ink version on light colours) | Bella+Canvas 3001 |
| Connection Hoodie | same | Gildan 18500 or B+C 3719 |
| Connection Windbreaker | `emblem-gold-3000.png` front, `windbreaker-back-*.png` back | any shell with a **back** print area — confirm before ordering |
| Connect Sticker Set | `emblem-gold-3000.png` | die-cut vinyl, ~3.2 in |

**You do not need to find variant IDs.** Once products exist I read them from the
API and fill the mapping myself.

### 2. Register the Printful webhook — 3 min

The URL and token are already generated for you. In Printful → **Settings → API →
Webhooks → Add webhook**:

- **URL:** `https://armoniaconnect.com/api/store/supplier-webhook?token=0dff2e23677577d19ab3bb5840532f67`
- **Events:** `package_shipped`, `order_failed`, `order_canceled`, `package_returned`

### 3. PrintKK account and keys — 15 min

1. Sign up at **printkk.com**, add a payment method, top the wallet up ~$20
2. **Setting → Api Management** → copy the **API key** and the **Secret key**
   (both are needed — the secret signs every request)
3. Enable modules: **General, Order, Shipment** (+ **Image, Design** if you want
   me to build the pick-set design)

Send both keys.

---

## Already done for you in Vercel

| Variable | State |
| --- | --- |
| `PRINTFUL_API_TOKEN` | ✅ set (you sent it) |
| `PRINTFUL_WEBHOOK_TOKEN` | ✅ set to the value in step 2 above |
| `CRON_SECRET` | ✅ set |
| `PRINTKK_API_KEY` / `PRINTKK_SECRET_KEY` | ⬜ waiting on step 3 |
| `PRINTFUL_DRAFT` | ⬜ set to `1` before the first test order |

`PRINTFUL_DRAFT=1` means Printful creates a draft instead of producing anything.
Turn it off only after a test order comes back correct.

---

## Decisions only you can make

| # | Question | Why it matters |
| --- | --- | --- |
| 1 | **Returns address** — a real US address | the shipping page promises 30-day returns and currently has nowhere for them to go |
| 2 | **Do the prices cover supplier cost?** | a hoodie is roughly $30–35 to make and ship, against a $68 price |
| 3 | **Red ring on the back print — yes or no?** | it is the one thing missing from your reference |
| 4 | **Sales tax** in Stripe | receipts and legal exposure |
| 5 | **Windbreaker blank** — confirm it has a back print area | otherwise the back design is wasted |
