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

## 6. The Lessons CMS — no more editing code to add lessons

Lesson content now lives in the database, managed entirely from `/admin/`
under the **Lessons** tab. You no longer edit any file to add a lesson.

**a) Run one more schema file**
Supabase → SQL Editor → paste in `supabase/schema-v3.sql` → Run. This
creates the `lessons` and `resources` tables that replace the old
`lib/lessonLibrary.js` (which has been removed — it's fully superseded).

**b) Adding a lesson**
Go to `armoniaconnect.com/admin` → **Lessons** tab → **+ Add Lesson**.
Pick the instrument, the section (Etude / Practice Technique /
Performance Track / Etude in Fifths — that last one only applies to
Guitarra de Golpe), give it a title and description, and either:
- paste a **Soundslice ID** once you have your Soundslice licensing (just
  the number from your embed URL — `soundslice.com/slices/`**`123456`**`/embed/`), or
- paste a **direct video URL** if you're hosting the lesson video
  elsewhere (e.g. Vimeo).

Save, and it's live on the course site immediately — no redeploy needed,
since this is a database change, not a code change.

**c) Adding chord books / MIDI tracks**
Same tab, further down — **+ Add Resource**, pick Chord Book or MIDI
Track, title, and a file URL (link to a PDF or audio file you've hosted
somewhere, e.g. a Supabase Storage bucket like you use for profile
photos, or Google Drive with public link sharing).

**d) When your Soundslice licensing comes through**
Nothing else needs to change — the Soundslice ID field in the Lessons CMS
is already wired up. Every lesson you've entered with a Soundslice ID
will start rendering the interactive embed on the student dashboard the
moment you paste that ID in.

## 7. Legal pages

Two drafts are included in the `legal/` folder: `terms-and-conditions.md`
and `privacy-policy.md`, written specifically around how Armonía Connect
works (access codes, single-session login, piracy consequences, the
third-party services you use). **These are starting drafts, not legal
advice** — get them reviewed by a Texas-licensed attorney before
publishing, especially given you're handling payments from and
communications with students who are likely minors. Once you're happy
with the wording, tell me and I'll turn them into real pages on the site
(e.g. `armoniaconnect.com/terms` and `/privacy`) linked from the footer
and checkout flow.

## 9. Setting up the other features (profiles, chat, announcements, single-session security)

**a) Run the new database tables**
Supabase → SQL Editor → paste in `supabase/schema-v2.sql` → Run. This is
additive and safe even if you've already run `schema.sql`.

**b) Create a Storage bucket for profile photos**
1. Supabase → **Storage** (left sidebar) → **New bucket**
2. Name it exactly: `profile-photos`
3. Toggle **Public bucket** ON (so photos display without extra auth)
4. Create

**c) Set your admin password**
Add one more environment variable in Vercel:
```
ADMIN_PASSWORD=choose-something-only-you-know
```
Redeploy after adding it.

**d) Where things live**
- Students log in at `/course/` same as before — first-time students now
  land on `/course/onboarding.html` (name, instrument, experience, bio,
  photo) before reaching the dashboard.
- The redesigned dashboard (`/course/dashboard.html`) has a sidebar:
  Announcements, each instrument, Chord Books & MIDI, Message the Maestro,
  and My Profile.
- You manage everything at **`/admin/`** (e.g. `armoniaconnect.com/admin`)
  — log in with `ADMIN_PASSWORD`. From there you can see every student
  and their profile, message any of them directly (updates every few
  seconds, no page refresh needed), post an announcement to everyone, and
  revoke a code if needed.
- **Keep `/admin/` unlisted** — it's protected by the password, but don't
  link to it publicly; just bookmark it yourself.

**e) How the single-session lock works**
Every time a code is used to log in, that login gets a fresh session
token, overwriting whatever was there before. Every other tab/device
using that code gets automatically signed out within about 15 seconds,
with a message explaining why — so a code can only ever be "in use" in
one place at a time. If a student legitimately switches devices, they
just re-enter their code and their old session ends automatically — no
action needed from you. If you ever see a code logging in constantly
from very different places/devices, that's your signal it may be shared;
revoke it from the admin panel.

## 11. Site text editing, Terms/Privacy/Credits pages

**a) The pages themselves:**
- `armoniaconnect.com/course/terms.html` — Terms & Conditions
- `armoniaconnect.com/course/privacy.html` — Privacy Policy
- `armoniaconnect.com/course/credits.html` — Thank You & Credits, with a placeholder box for your closing video. When you have the video ready, tell Claude and it'll wire in a real embed (Vimeo, direct file, etc.) in place of the placeholder.

All three are linked from the dashboard sidebar and match the site's look.

**b) Editing text without touching code:**
`/admin/` has a new **Site Text** tab — edit the Announcements page title/subtitle and the Thank You page's title/subtitle/message right from a form, no code or redeploy needed. This uses the `site_content` table from `schema-v3.sql`, so make sure you've run that file in Supabase.

More fields can be made editable the same way later — just tell Claude which text you want to control, and it adds it to that list.

Once steps 1–5 are done and tested, put `https://armonia-mariachi.com` (or

## 12. Community — real posts, one-tap likes, replies, images

**a) Run one more schema file**
Supabase → SQL Editor → paste in `supabase/schema-v4.sql` → Run. This adds
`community_posts`, `community_likes`, and `community_replies`.

**b) Create a Storage bucket for post images**
Same as you did for `profile-photos`: Supabase → **Storage** → **New
bucket** → name it exactly `community-images` → toggle **Public bucket**
ON → Create.

**c) How it actually works**
- Students post text and/or an image from the Community tab.
- **Likes are a real toggle**, enforced by the database itself — there's
  a unique constraint on (post, student), so double-liking is impossible
  even if two clicks fire at once. Clicking again removes the like.
- **Replies work** — click "Reply" under any post to expand a thread and
  add your own.
- Every other student's raw access code is never sent to the browser —
  only their display name, photo, and instrument. The like/reply/post
  endpoints all check "is this the logged-in student's own item" server-side.

**d) Your own profile in Community**
`/admin/` → **Site Text** tab → **Your Community Profile** section. Set
your name, bio, and upload a photo — that's what shows in the pinned
"Maestro" card at the top of every student's Community tab. Clicking it
takes them straight to messaging you (the same system as the sidebar's
"Message the Maestro").

## 13. A note on who can edit what

Every editing feature — Lessons, Resources, Site Text, your Community
profile, announcements, revoking codes — lives behind `/admin/` and your
`ADMIN_PASSWORD`. The student-facing site (`/course/...`) never calls any
`/api/admin/...` endpoint and has no edit controls anywhere in it. A
student cannot reach editing features even if they know the URLs, because
every admin endpoint independently re-checks the admin password's token
server-side — it doesn't matter what page they're looking at.

## 14. Device binding — a code only ever works on one device

**a) Run one more schema file**
Supabase → SQL Editor → paste in `supabase/schema-v5.sql` → Run.

**b) How it works**
The first time a code is used to log in, it's permanently tied to that
browser (a random ID stored in that browser's `localStorage`, separate
from the session token). If someone tries to use the same code from a
different phone or computer after that, they're rejected immediately
with a message asking them to contact you — it's not just "logged out,"
it's refused outright.

**c) The trade-off, on purpose**
This means a student can only use their code on **one device, ever**,
unless you reset it. That's intentional — it's what actually stops "here,
borrow my code." But it means a legitimate student who gets a new phone,
resets their old one, or wants to switch from phone to laptop will hit
this wall too.

**d) Releasing a device (for legitimate changes)**
`/admin/` → Students tab → any student showing "Bound" has a **Reset
Device** button. Use it after confirming with the student (e.g. by email
or in your DM thread with them) that it's a genuine device change — not
just anyone asking, since resetting it is also what someone would ask
for if they'd been caught sharing a code and wanted a clean slate.

**e) What this doesn't fully stop**
A technically determined person could clear their browser's storage to
appear as a "new" device and re-trigger a fresh binding. Combined with
the single-active-session system already in place, this makes casual
sharing (the "here's my code" text to a friend) meaningfully harder — but
it's not a perfect lock. If you want a stronger version later (e.g.
requiring email confirmation before a new device is approved), that's a
reasonable next step.

## 15. Device requests, real admin account, and the loading screen

**a) Run one more schema file**
Supabase → SQL Editor → paste in `supabase/schema-v6.sql` → Run.

**b) Device requests — you approve, not the system**
The device-binding from before now works differently: instead of a
device mismatch being silently rejected forever, it creates a request in
`/admin/` → **Device Requests** tab. You see the code, a shortened
version of the device fingerprint, and when it happened — **Approve** to
let that device in (rebinds the code to it), or **Deny** to leave it
blocked. Nothing changes automatically without you.

**c) Your admin account is now real, not just an env var**
The first time you log into `/admin/` after this update, your existing
`ADMIN_PASSWORD` becomes your actual password (hashed and stored in the
database) — after that first login, changing your password from
**Account Settings** is what actually matters; the env var is never
checked again. From that same tab:
- **Name** — saves instantly, and also updates what students see as your
  name in Community (one field, kept in sync automatically)
- **Login email** — editable, with a real **Verify** button that emails
  you a confirmation link (uses your existing Resend setup)
- **Billing email** — separate editable field for invoice/billing contact
- **Password** — actually changes it; verifies your current password first
- **Manage Billing** — opens your real Stripe dashboard in a new tab,
  since that's where your actual billing lives (student payments, payouts)
- **Support Information** — your account ID and when your admin account
  was created

**d) The animated loading screen**
Shows on the flyer page and the course dashboard every time they're
opened or refreshed — your logo with a slow pulsing ring, and a random
mariachi fun fact from the list you gave me. Stays up for at least 1.6
seconds (long enough to actually read) even if the page loads faster than
that, then fades out. Want it on other pages too (Community, Terms,
etc.)? Just say which ones.

## 17. The dashboard redesign is now live in the code

Everything from the final preview is merged into the real, deployable
`public/course/dashboard.html` — not just a mockup anymore:

- The new logo, animated background pattern, custom icon set, and
  collapsible sidebar
- Course Library as portal cards, same as before but restyled
- **Community** — real posts, images, one-tap-toggle likes, working
  replies — pulling from the backend built earlier
- Messaging is reached by clicking the Maestro's card in Community (or
  the community icon in the top bar) rather than a dedicated sidebar
  entry, matching the last design you approved
- **My Profile** — same real editing/photo upload as before, with the
  fixed avatar display and the nicer banner-style layout
- The 4.5-second animated loading screen with your fun facts, wired to
  real page-load

**One deliberate removal:** the earlier preview mockups included a
"Settings" page with fields like Name, Login Email, and Password — that
was actually modeling *your* admin account, not a student's. It never
belonged on the student dashboard. That functionality already has its
real home in `/admin/` → **Account Settings**, which is fully working.
I dropped the confusing duplicate from the student view.

Push this to GitHub and Vercel will redeploy it to `armoniaconnect.com`
automatically, same as every update before.

## 18. Linking from Instagram

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
