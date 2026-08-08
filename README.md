# Armonía — Deployment Guide

This is everything for: the public flyer page, real Stripe checkout, automatic
access-code emails, the contact form, and the gated course site with Soundslice
embeds. It's all one project so you only manage one deployment.

You'll need to create four free accounts if you don't have them already:
**Vercel, Stripe, Supabase, Resend.** Budget about 45–60 minutes for first setup.

---

## 0. What's in this folder

```
public/index.html          → your flyer/landing page (fixed, ready to deploy)
public/course/index.html   → course login (students enter their code here)
public/course/dashboard.html → lesson library with Soundslice embeds
api/checkout.js            → (optional/advanced) creates Stripe Checkout sessions
api/webhook.js             → the automation: payment → code → email
api/contact.js             → routes the contact form to your Gmail
api/redeem.js              → validates a code, logs students in
api/lessons.js             → serves your lesson list once logged in — ADD YOUR LESSONS HERE
lib/                        → shared helpers (email templates, Supabase client, code generator)
supabase/schema.sql        → run this once to create your database tables
.env.example               → copy into Vercel's environment variables
```

---

## 1. Supabase (stores access codes)

1. Go to supabase.com → New Project (free tier is plenty).
2. Once it's created, go to the **SQL Editor** → paste in the contents of
   `supabase/schema.sql` → **Run**. This creates your `access_codes`,
   `login_events`, and `contact_messages` tables.
3. Go to **Project Settings → API**. Copy:
   - **Project URL** → this is `SUPABASE_URL`
   - **service_role key** (not "anon") → this is `SUPABASE_SERVICE_ROLE_KEY`
   - Keep this key secret — it has full database access.

## 2. Resend (sends the emails)

1. Go to resend.com → sign up → **Domains** → add `armonia-mariachi.com`
   (or whatever domain you land on).
2. Resend gives you 3 DNS records (SPF, DKIM, a tracking record) to add at
   your domain registrar (GoDaddy, Namecheap, wherever you bought the domain).
   This is what lets your emails actually land in inboxes instead of spam.
   Verification usually takes a few minutes to a few hours.
3. Once verified, go to **API Keys** → create one → this is `RESEND_API_KEY`.
4. Set `FROM_EMAIL` to something like `Armonía <no-reply@armonia-mariachi.com>`
   using your verified domain.
   - *Don't have a domain yet?* Resend gives you a temporary
     `onboarding@resend.dev` address that works immediately for testing,
     but switch to your own domain before launch — it looks more professional
     and has better deliverability.

## 3. Stripe (payments)

1. Go to stripe.com → create an account, and get it out of **test mode**
   into **live mode** when you're ready to accept real payments (there's a
   toggle top-right of the dashboard).
2. **Create your product & payment link:**
   - Dashboard → **Payment links** → **New**
   - Product name: "Armonía — TMEA All-State Mariachi Course", price $100, one-time
   - Under "Customer information," confirm **"Collect customer's email"** is ON
     (this is what lets us email them their code)
   - Save, copy the link (looks like `https://buy.stripe.com/xxxxx`)
3. Open `public/index.html`, search for `buy.stripe.com/test_9B68wObjqc2F219c7v0co00`
   and replace it with your real live payment link.
4. **Register the webhook** (this is what triggers the automatic email):
   - Dashboard → **Developers → Webhooks → Add endpoint**
   - Endpoint URL: `https://armonia-mariachi.com/api/webhook` (your real domain)
   - Select event: `checkout.session.completed`
   - Save, then click into the new endpoint and copy the **Signing secret**
     (starts with `whsec_`) → this is `STRIPE_WEBHOOK_SECRET`
5. Dashboard → **Developers → API keys** → copy the **Secret key**
   (starts with `sk_live_`) → this is `STRIPE_SECRET_KEY`

## 4. Vercel (hosting + the automation functions)

1. Push this whole folder to a GitHub repo (Vercel deploys from GitHub).
   ```
   cd armonia-project
   git init
   git add .
   git commit -m "Armonía course site"
   git remote add origin <your-empty-github-repo-url>
   git push -u origin main
   ```
2. Go to vercel.com → **Add New → Project** → import that repo → Deploy.
   Vercel auto-detects the `api/` folder as serverless functions and `public/`
   as your static site — no config needed.
3. Once deployed, go to **Project → Settings → Environment Variables** and
   add every value from `.env.example` with your real keys.
4. Go to **Project → Settings → Domains** → add `armonia-mariachi.com`
   (or your domain) and follow Vercel's DNS instructions at your registrar.
5. Redeploy (Vercel does this automatically after env vars change, or click
   **Redeploy** in the Deployments tab).

## 5. Test it end-to-end before linking Instagram

1. In Stripe, keep **test mode** on for this. Use test card `4242 4242 4242 4242`,
   any future expiry, any CVC.
2. Go to your live site, click Enroll, complete the test payment.
3. Check: did an email arrive with a code? Check Supabase's `access_codes`
   table — is the row there?
4. Go to `armonia-mariachi.com/course/`, enter that code, confirm the
   dashboard loads.
5. Fill out the contact form on the flyer, confirm it lands in
   maestro.armoniaconnect@gmail.com.
6. Once everything works, switch Stripe to **live mode**, create a live
   payment link (step 3 above uses live mode already if you toggled it),
   and you're ready for real customers.

## 6. Adding your lessons as you finish editing them

Open `api/lessons.js` and add an entry to the `LESSONS` array for each
finished lesson:

```js
{
  id: 3,
  title: 'Lesson 3 — Manico Patterns II',
  description: 'Building speed without losing clarity.',
  videoUrl: 'https://your-video-host.com/lesson3.mp4', // if hosting video directly
  soundsliceId: '123456', // if using a Soundslice embed for the performance track
},
```

Push the change (`git push`) and Vercel redeploys automatically — no other
steps needed, every enrolled student sees the new lesson immediately.

**Soundslice ID:** in your Soundslice dashboard, open a slice → **Embed** →
the ID is the number in the embed code's URL
(`soundslice.com/slices/`**`123456`**`/embed/`).

## 7. Linking from Instagram

Once steps 1–5 are done and tested, put `https://armonia-mariachi.com` (or
your chosen domain) in your Instagram bio link. That's the whole flyer page —
enrollment, everything included list, and contact form all live there.

---

## Notes on what's simplified for launch

- **Video hosting:** `lessons.js` currently supports either a direct video
  URL or a Soundslice embed. For lesson *videos* (not performance tracks),
  you'll want a video host — Vimeo (paid, private/unlisted links) or
  Bunny.net are both reasonable options once you're ready; for now you can
  leave `videoUrl` blank and the dashboard shows "Video coming soon."
- **Refunds:** if you refund someone in Stripe, manually set `revoked = true`
  on their row in the Supabase `access_codes` table to cut off their course
  access — this isn't automatic yet.
- **Security:** this is proportionate to a $100 course, not a bank. Codes
  are long and random, sessions expire after 30 days, and the service-role
  Supabase key never touches the browser. If this grows significantly, add
  rate-limiting to `/api/redeem`.
