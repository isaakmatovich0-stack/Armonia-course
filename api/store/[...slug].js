// ════════════════════════════════════════════════════════════════════════
//  /api/store/*  — the Armonia Connect merch store
// ════════════════════════════════════════════════════════════════════════
//
// One serverless function for the whole store, for the same reason the other
// API files are consolidated: Vercel's Hobby plan caps a project at 12
// functions and every file in /api counts as one. Like api/admin/[...slug].js,
// this catch-all is what routes /api/store/bag, /api/store/checkout, … into a
// single handler (a bare api/store.js would only match /api/store itself and
// let /api/[...slug].js swallow the rest); the route is read from the path.
//
//   GET    /api/store/catalog    public catalog + shipping rules + live flag
//   GET    /api/store/shipping   shipping rules on their own
//   GET    /api/store/bag        current bag (creates one lazily)
//   POST   /api/store/bag        { action: add|update|remove|clear|promo, … }
//   POST   /api/store/checkout   create a Stripe Checkout Session → { url }
//   GET    /api/store/order      ?session_id=… confirmation lookup
//   POST   /api/store/subscribe  newsletter signup
//   POST   /api/store/contact    store contact form
//   POST   /api/store/webhook    Stripe webhook (raw body, signature verified)
//
// Security model, in one line each:
//   • prices are read server-side from store/catalog.json — never from the
//     browser;
//   • the bag lives in Postgres keyed by an HttpOnly cookie, so the totals
//     Stripe charges come from a row we wrote, not from a request body;
//   • discounts only ever come from the store_promo_codes table;
//   • the webhook verifies the Stripe signature before trusting a word of it;
//   • order lookups are keyed by the Stripe session id, which is unguessable.

import Stripe from 'stripe';
import {
  publicCatalog,
  publicShipping,
  priceBag,
  normalizeItems,
  loadCatalog,
  isCheckoutLive,
  productImageUrls,
} from '../../lib/store/catalog.js';
import { resolveBag, saveCart, loadPromo, cartCookie, isValidCartId } from '../../lib/store/cart.js';
import {
  getCart,
  recordCheckoutSession,
  recordPaidOrder,
  markSessionExpired,
  incrementPromoUse,
  addSubscriber,
  logContactMessage,
  isLocalMode,
} from '../../lib/store/db.js';
import { orderFromStripeSession, upsertOrder, findOrderBySession, publicOrder, itemsForMetadata } from '../../lib/store/orders.js';
import { sendStoreOrderConfirmation, sendStoreOrderNotification, sendStoreContactNotification } from '../../lib/email.js';

/* ── Stripe webhooks need the untouched request body ───────────────────── */
export const config = {
  api: { bodyParser: false },
};

const SITE_URL = (process.env.SITE_URL || 'https://www.armoniaconnect.com').replace(/\/$/, '');
const STORE_URL = `${SITE_URL}/store/`;

let stripeClient = null;
function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!stripeClient) stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  return stripeClient;
}

/* ── helpers ──────────────────────────────────────────────────────────── */

async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  // A parsed body means something upstream already consumed the stream; the
  // raw bytes Stripe signed are gone. Re-serialising JSON would not reproduce
  // them, so fail loudly instead of hanging or accepting an unverified event.
  if (req.body && typeof req.body === 'object') {
    throw new Error('Request body was parsed before signature verification.');
  }
  if (req.readableEnded || req.complete) {
    throw new Error('Request body was already consumed before signature verification.');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function jsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  try {
    return JSON.parse(req.body.toString());
  } catch {
    return {};
  }
}

function origin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return host ? `${proto}://${host}` : SITE_URL;
}

function bagResponse(bag) {
  return {
    bag,
    lines: bag ? bag.lines : [],
    count: bag ? bag.count : 0,
    subtotalCents: bag ? bag.subtotalCents : 0,
    discountCents: bag ? bag.discountCents : 0,
    shippingCents: bag ? bag.shippingCents : 0,
    totalCents: bag ? bag.totalCents : 0,
    freeShippingThresholdCents: bag ? bag.freeShippingThresholdCents : publicShipping().freeShippingThresholdCents,
    shipping: bag ? bag.shipping : null,
    promo: bag ? bag.promo : null,
    currency: 'USD',
    live: isCheckoutLive(),
  };
}

/** Echo the cart id so cookie-blocked browsers can still keep their bag. */
function tagCart(res, cart) {
  if (cart && cart.id) {
    res.setHeader('X-Cart-Id', cart.id);
    res.setHeader('Access-Control-Expose-Headers', 'X-Cart-Id');
  }
}

function devOrderNumber() {
  const alphabet = 'ACDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'AC-';
  for (let index = 0; index < 6; index += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function clientError(res, status, message, extra = {}) {
  return res.status(status).json({ error: message, ...extra });
}

/* ══════════════════════════════════════════════════════════════════════
   HANDLER
   ══════════════════════════════════════════════════════════════════════ */

export default async function handler(req, res) {
  const parts = String(req.url || '').split('?')[0].split('/').filter(Boolean); // ['api','store','bag']
  const route = parts[2] || '';
  const method = req.method || 'GET';

  res.setHeader('Cache-Control', 'no-store');

  try {
    /* ── catalog ─────────────────────────────────────────────────────── */
    if (route === 'catalog') {
      if (method !== 'GET') return clientError(res, 405, 'Method not allowed.');
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
      return res.status(200).json(publicCatalog());
    }

    /* ── shipping rules ──────────────────────────────────────────────── */
    if (route === 'shipping') {
      if (method !== 'GET') return clientError(res, 405, 'Method not allowed.');
      return res.status(200).json({ ...publicShipping(), live: isCheckoutLive() });
    }

    /* ── bag ─────────────────────────────────────────────────────────── */
    if (route === 'bag') {
      if (method === 'GET') {
        const { cart, bag } = await resolveBag(req, { create: false });
        if (!cart) return res.status(200).json({ ...bagResponse(priceBag([])), live: isCheckoutLive() });
        tagCart(res, cart);
        return res.status(200).json(bagResponse(bag));
      }

      if (method === 'POST') {
        const body = jsonBody(req);
        const action = String(body.action || '');
        const { cart } = await resolveBag(req, { create: true });
        tagCart(res, cart);
        const current = normalizeItems(cart.items || []).items;

        if (action === 'add') {
          const catalog = loadCatalog();
          const product = catalog.byId.get(String(body.productId || ''));
          if (!product) return clientError(res, 400, 'That product is no longer available.');
          const color = String(body.color || product.colors[0]);
          const size = String(body.size || product.sizes[0]);
          if (!product.colors.includes(color)) return clientError(res, 400, 'That colour is not available.');
          if (!product.sizes.includes(size)) return clientError(res, 400, 'That size is not available.');
          const quantity = Math.max(1, Math.min(20, Math.floor(Number(body.quantity) || 1)));
          current.push({ productId: product.id, color, size, quantity });
        } else if (action === 'update') {
          const key = String(body.key || '');
          const quantity = Math.max(0, Math.min(20, Math.floor(Number(body.quantity) || 0)));
          const [productId, color, size] = key.split('|');
          const index = current.findIndex((item) => item.productId === productId && item.color === color && item.size === size);
          if (index === -1) return clientError(res, 404, 'That item is no longer in your bag.');
          if (quantity === 0) current.splice(index, 1);
          else current[index].quantity = quantity;
        } else if (action === 'remove') {
          const [productId, color, size] = String(body.key || '').split('|');
          const index = current.findIndex((item) => item.productId === productId && item.color === color && item.size === size);
          if (index !== -1) current.splice(index, 1);
        } else if (action === 'clear') {
          current.length = 0;
        } else if (action === 'promo') {
          const code = String(body.code || '').trim().toUpperCase();
          if (!code) {
            await saveCart(cart.id, { promoCode: null, items: current });
            res.setHeader('Set-Cookie', cartCookie(cart.id));
            return res.status(200).json(bagResponse(priceBag(normalizeItems(current).items)));
          }
          const row = await loadPromo(code);
          const priced = priceBag(normalizeItems(current).items, { promoCode: code, promoRow: row });
          if (!priced.promo || !priced.promo.valid) {
            return clientError(res, 400, (priced.promo && priced.promo.message) || 'That code isn’t recognised.', { promo: priced.promo });
          }
          await saveCart(cart.id, { promoCode: code, items: current });
          res.setHeader('Set-Cookie', cartCookie(cart.id));
          return res.status(200).json(bagResponse(priced));
        } else {
          return clientError(res, 400, 'Unknown bag action.');
        }

        const { items } = normalizeItems(current);
        const updated = await saveCart(cart.id, { items });
        const promoRow = updated.promo_code ? await loadPromo(updated.promo_code) : null;
        const bag = priceBag(items, { promoCode: updated.promo_code, promoRow });
        res.setHeader('Set-Cookie', cartCookie(cart.id));
        return res.status(200).json(bagResponse(bag));
      }

      return clientError(res, 405, 'Method not allowed.');
    }

    /* ── checkout ────────────────────────────────────────────────────── */
    if (route === 'checkout') {
      if (method !== 'POST') return clientError(res, 405, 'Method not allowed.');

      const stripeApi = stripe();
      const { cart, items, bag } = await resolveBag(req, { create: false });
      if (cart) tagCart(res, cart);
      if (!bag || bag.lines.length === 0) {
        return clientError(res, 400, 'Your bag is empty — add something good first.');
      }
      if (!stripeApi) {
        return clientError(res, 503, 'Checkout isn’t switched on yet. Add STRIPE_SECRET_KEY in Vercel to start taking orders.', {
          mode: 'not_configured',
        });
      }

      const catalog = loadCatalog();
      const shipping = publicShipping();
      const metadataItems = itemsForMetadata(bag);
      const sessionItems = bag.lines.map((line) => ({
        productId: line.productId,
        name: line.shortName,
        color: line.colorName,
        size: line.size,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
      }));

      const lineItems = bag.lines.map((line) => {
        const product = catalog.byId.get(line.productId);
        const images = product ? productImageUrls(product, origin(req), line.color) : [];
        return {
          quantity: line.quantity,
          price_data: {
            currency: shipping.currency,
            unit_amount: line.unitPriceCents,
            product_data: {
              name: line.name,
              description: [line.colorName, line.size].filter(Boolean).join(' / '),
              images,
              metadata: { productId: line.productId },
            },
          },
        };
      });

      if (bag.shippingCents > 0) {
        lineItems.push({
          quantity: 1,
          price_data: {
            currency: shipping.currency,
            unit_amount: bag.shippingCents,
            product_data: { name: 'Standard US shipping', description: shipping.estimate },
          },
        });
      }

      // A free-shipping code with a free-shipping order has nothing left to
      // discount, but it is still "applied": handing the customer an open promo
      // field at that point would let them stack a second code on top of it.
      const promoApplied = Boolean(bag.promo && bag.promo.valid);

      let discounts;
      const promoDiscountsSomething = promoApplied && (bag.promo.amountCents > 0 || (bag.promo.freeShipping && bag.shippingCents > 0));
      if (promoDiscountsSomething) {
        try {
          const coupon = await ensureStripeCoupon(stripeApi, bag.promo);
          discounts = [{ coupon: coupon.id }];
        } catch (err) {
          console.error('[store] coupon create failed, refusing checkout', err.message);
          return clientError(res, 409, 'We couldn’t apply that discount. Remove the code and try again.');
        }
      }

      const sessionParams = {
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: lineItems,
        allow_promotion_codes: !discounts && !promoApplied,
        billing_address_collection: 'auto',
        success_url: `${STORE_URL}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${STORE_URL}?checkout=cancelled`,
        customer_creation: 'always',
        metadata: {
          cart_id: cart.id,
          promo_code: bag.promo && bag.promo.valid ? bag.promo.code : '',
          items_json: JSON.stringify(metadataItems),
          source: 'armonia-store',
        },
        shipping_address_collection: { allowed_countries: shipping.countries },
        phone_number_collection: { enabled: false },
        custom_text: {
          submit: { message: '30-day returns at our US fulfilment partner · Ships in 2–4 business days.' },
          after_submit: { message: 'Thanks! Your receipt and order updates are on their way by email.' },
        },
        invoice_creation: { enabled: true },
      };

      if (discounts) sessionParams.discounts = discounts;

      let session;
      try {
        session = await stripeApi.checkout.sessions.create(sessionParams);
      } catch (err) {
        console.error('[store] stripe session failed', err);
        // Most common cause: tax/address config mismatch. Retry once without
        // the optional niceties so a real customer isn't blocked.
        try {
          const { custom_text, invoice_creation, allow_promotion_codes, ...fallback } = sessionParams;
          session = await stripeApi.checkout.sessions.create(fallback);
        } catch (secondErr) {
          console.error('[store] stripe session retry failed', secondErr);
          return clientError(res, 502, 'We couldn’t open checkout just now. Please try again in a moment.');
        }
      }

      // Remember what we asked Stripe for, so a session that is paid but whose
      // webhook goes missing can still be reconciled from Stripe later.
      try {
        await recordCheckoutSession({
          stripe_session_id: session.id,
          cart_id: cart.id,
          items: sessionItems,
          amount_total: bag.totalCents,
          promo_code: bag.promo && bag.promo.valid ? bag.promo.code : null,
        });
      } catch (err) {
        console.warn('[store] could not record checkout session', err.message);
      }

      return res.status(200).json({ url: session.url, id: session.id });
    }

    /* ── order lookup (confirmation screen) ──────────────────────────── */
    if (route === 'order') {
      if (method !== 'GET') return clientError(res, 405, 'Method not allowed.');
      const url = new URL(req.url, origin(req));
      const sessionId = url.searchParams.get('session_id');
      if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return clientError(res, 400, 'Missing order reference.');

      const row = await findOrderBySession(sessionId);
      if (row) return res.status(200).json({ ...publicOrder(row), pending: false });

      // Webhook may not have landed yet — tell the page to keep polling.
      const stripeApi = stripe();
      if (stripeApi) {
        try {
          const session = await stripeApi.checkout.sessions.retrieve(sessionId);
          if (session && session.payment_status === 'paid') {
            const items = JSON.parse(session.metadata?.items_json || '[]');
            const { order } = await upsertOrder(orderFromStripeSession(session, { items }));
            return res.status(200).json({ ...publicOrder(order), pending: false });
          }
        } catch (err) {
          console.warn('[store] order lookup failed', err.message);
        }
      }
      return res.status(200).json({ pending: true });
    }

    /* ── dev only: fabricate a paid order ────────────────────────────────
       Lets the confirmation screen and the admin order book be exercised
       locally without Stripe keys. Refuses to run unless STORE_LOCAL_DB=1 and
       the app is not in production. */
    if (route === 'dev-seed-order') {
      if (!isLocalMode() || process.env.NODE_ENV === 'production') return clientError(res, 404, 'Not found.');
      if (method !== 'POST') return clientError(res, 405, 'Method not allowed.');
      const { bag } = await resolveBag(req, { create: true });
      if (!bag || !bag.lines.length) return clientError(res, 400, 'Add something to the bag first.');
      const sessionId = `cs_test_dev_${Date.now().toString(36)}`;
      const items = bag.lines.map((line) => ({
        productId: line.productId,
        name: line.shortName,
        color: line.colorName,
        size: line.size,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
      }));
      const { order } = await recordPaidOrder({
        stripe_session_id: sessionId,
        stripe_payment_intent_id: null,
        number: devOrderNumber(),
        email: 'tester@example.com',
        name: 'Test Checkout',
        phone: null,
        amount_subtotal: bag.subtotalCents,
        amount_shipping: bag.shippingCents,
        amount_tax: 0,
        amount_discount: bag.discountCents,
        amount_total: bag.totalCents,
        currency: 'usd',
        items,
        shipping_address: { line1: '123 Connection Lane', city: 'Spring', state: 'TX', postal_code: '77373', country: 'US' },
        cart_id: null,
        promo_code: bag.promo && bag.promo.valid ? bag.promo.code : null,
        status: 'paid',
        paid_at: new Date().toISOString(),
      });
      return res.status(200).json({ ok: true, sessionId, number: order.number, url: `/store/?checkout=success&session_id=${sessionId}` });
    }

    /* ── newsletter ──────────────────────────────────────────────────── */
    if (route === 'subscribe') {
      if (method !== 'POST') return clientError(res, 405, 'Method not allowed.');
      const { email, source } = jsonBody(req);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
        return clientError(res, 400, 'Please enter a valid email address.');
      }
      try {
        await addSubscriber({ email: String(email), source: String(source || 'store').slice(0, 60) });
      } catch (err) {
        console.error('[store] subscribe failed', err);
        return clientError(res, 500, 'Could not add you to the list. Please try again.');
      }
      return res.status(200).json({ ok: true });
    }

    /* ── contact form ────────────────────────────────────────────────── */
    if (route === 'contact') {
      if (method !== 'POST') return clientError(res, 405, 'Method not allowed.');
      const body = jsonBody(req);
      const name = String(body.name || '').trim().slice(0, 120);
      const email = String(body.email || '').trim();
      const subject = String(body.subject || '').trim().slice(0, 140) || 'Store enquiry';
      const message = String(body.message || '').trim().slice(0, 4000);

      if (!name || !message) return clientError(res, 400, 'Please add your name and a message.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return clientError(res, 400, 'Please enter a valid email address.');

      const [firstName, ...rest] = name.split(/\s+/);
      let logged = true;
      try {
        await logContactMessage({ firstName, lastName: rest.join(' ') || '—', email, subject: `Store: ${subject}`, message });
      } catch (err) {
        logged = false;
        console.error('[store] contact insert failed', err.message);
      }

      let mailed = false;
      try {
        const result = await sendStoreContactNotification({ name, email, subject, message });
        mailed = !(result && result.skipped);
      } catch (mailError) {
        console.error('[store] contact email failed', mailError);
      }

      if (!logged && !mailed) {
        return clientError(res, 500, 'Could not send your message. Please email us at maestro.armoniaconnect@gmail.com.');
      }
      return res.status(200).json({ ok: true });
    }

    /* ── Stripe webhook ──────────────────────────────────────────────── */
    if (route === 'webhook') {
      if (method !== 'POST') return clientError(res, 405, 'Method not allowed.');
      const stripeApi = stripe();
      if (!stripeApi) {
        console.error('[store] webhook hit but Stripe is not configured');
        return res.status(503).json({ error: 'Stripe is not configured.' });
      }

      // The store and the course are two separate Stripe endpoints, so each get
      // their own signing secret. Prefer the store-specific one and fall back to
      // the shared name for single-endpoint setups. Every candidate is tried so
      // rotating a secret (or pointing one endpoint at both URLs) keeps working.
      const secrets = [process.env.STRIPE_WEBHOOK_SECRET_STORE, process.env.STRIPE_WEBHOOK_SECRET]
        .filter(Boolean)
        .filter((value, index, all) => all.indexOf(value) === index);
      if (!secrets.length) {
        console.error('[store] webhook hit but no signing secret is configured');
        return res.status(503).json({ error: 'Stripe is not configured.' });
      }

      let payload;
      try {
        payload = await rawBody(req);
      } catch (err) {
        console.error('[store] webhook body unavailable:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      let event = null;
      let lastError = null;
      for (const secret of secrets) {
        try {
          event = stripeApi.webhooks.constructEvent(payload, req.headers['stripe-signature'], secret);
          break;
        } catch (err) {
          lastError = err;
        }
      }
      if (!event) {
        console.error('[store] webhook signature rejected:', lastError && lastError.message);
        return res.status(400).send(`Webhook Error: ${lastError ? lastError.message : 'invalid signature'}`);
      }

      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        const session = event.data.object;
        // `complete` alone is not enough: delayed payment methods can complete
        // a session before the money lands. Only record orders that are paid.
        if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
          try {
            const { order, created } = await completeOrder(session, stripeApi);
            if (created && order && order.email) {
              await sendStoreOrderConfirmation({
                to: order.email,
                name: order.name,
                orderNumber: order.number,
                items: order.items || [],
                subtotalCents: order.amount_subtotal,
                shippingCents: order.amount_shipping,
                taxCents: order.amount_tax,
                discountCents: order.amount_discount,
                totalCents: order.amount_total,
                shippingAddress: order.shipping_address,
                promoCode: order.promo_code,
              }).catch((err) => console.error('[store] receipt email failed', err));
              await sendStoreOrderNotification({
                orderNumber: order.number,
                name: order.name,
                email: order.email,
                items: order.items || [],
                totalCents: order.amount_total,
                shippingAddress: order.shipping_address,
              }).catch((err) => console.error('[store] shop alert failed', err));
            }
            return res.status(200).json({ received: true, order: order ? order.number : null });
          } catch (err) {
            console.error('[store] order completion failed', err);
            // 500 → Stripe retries; the handler is idempotent.
            return res.status(500).json({ error: 'Order could not be recorded.' });
          }
        }
      }

      if (event.type === 'checkout.session.expired') {
        try {
          await markSessionExpired(event.data.object.id);
        } catch (err) {
          console.warn('[store] could not mark session expired', err.message);
        }
      }

      return res.status(200).json({ received: true });
    }

    return clientError(res, 404, 'Unknown store endpoint.');
  } catch (err) {
    console.error('[store] unhandled error', route, err);
    return clientError(res, 500, 'Something went wrong on our side. Please try again.');
  }
}

/* ── internals ────────────────────────────────────────────────────────── */

/**
 * Create (or reuse) a Stripe coupon for a promo code. Stripe coupons are
 * limited to 500 per account, so the code is stable per promo and reused.
 */
async function ensureStripeCoupon(stripeApi, promo) {
  const couponId = `ac_${String(promo.code).replace(/[^A-Za-z0-9]/g, '').slice(0, 30).toUpperCase()}`;
  try {
    return await stripeApi.coupons.retrieve(couponId);
  } catch {
    const params = { id: couponId, duration: 'once', name: `${promo.code} — ${promo.description || 'Discount'}` };
    if (promo.freeShipping) {
      return stripeApi.coupons.create({ ...params, amount_off: publicShipping().standardShippingCents, currency: 'usd', name: `${promo.code} — free shipping` });
    }
    if (promo.amountCents && promo.amountCents > 0) {
      return stripeApi.coupons.create({ ...params, amount_off: promo.amountCents, currency: 'usd' });
    }
    throw new Error('Promo has no discount value.');
  }
}

/** Record an order from a paid Checkout Session and tidy up the bag. */
async function completeOrder(session, stripeApi) {
  let items = [];
  try {
    items = JSON.parse(session.metadata?.items_json || '[]');
  } catch {
    items = [];
  }

  // Fall back to the stored cart when metadata is missing/truncated.
  const cartId = session.metadata?.cart_id;
  if ((!items || items.length === 0) && isValidCartId(cartId)) {
    const cart = await getCart(cartId);
    if (cart) items = normalizeItems(cart.items || []).items;
  }

  // Prefer Stripe's line items when we have nothing else (e.g. a session
  // created from the Stripe dashboard).
  if (!items.length && stripeApi) {
    try {
      const lineItems = await stripeApi.checkout.sessions.listLineItems(session.id, { expand: ['data.price.product'], limit: 100 });
      items = lineItems.data.map((line) => ({
        productId: line.price?.product?.metadata?.productId || null,
        name: line.description || line.price?.product?.name || 'Item',
        quantity: line.quantity || 1,
        unitPriceCents: line.amount_subtotal && line.quantity ? Math.round(line.amount_subtotal / line.quantity) : line.amount_total || 0,
      }));
    } catch (err) {
      console.warn('[store] could not read line items', err.message);
    }
  }

  const record = orderFromStripeSession(session, { cartId, items });
  const { order, created } = await upsertOrder(record);

  // Increment promo usage once, and empty the bag.
  if (created && session.metadata?.promo_code) {
    try {
      await incrementPromoUse(session.metadata.promo_code);
    } catch (err) {
      console.warn('[store] could not count promo use', err.message);
    }
  }

  if (isValidCartId(cartId)) {
    try {
      await saveCart(cartId, { items: [], promoCode: null });
    } catch (err) {
      console.warn('[store] could not empty the cart', err.message);
    }
  }

  return { order, created };
}
