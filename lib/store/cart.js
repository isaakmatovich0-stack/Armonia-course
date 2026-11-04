// Bag / cart persistence for the store.
//
// A bag is a real database row so it survives the redirect to Stripe, the
// customer switching devices, and a closed tab. That also means the totals
// Stripe is asked to charge are always recomputed from an item list we stored
// — never from numbers that arrived in a request body.
//
// Rows live in `store_carts`, keyed by an opaque cart id. The browser holds
// that id in an HttpOnly, SameSite=Lax cookie, so page scripts (including any
// third-party snippet that might be added later) cannot read or tamper with it.
//
// All storage access goes through ./db.js, which is Postgres in production and
// a local JSON file when STORE_LOCAL_DB=1 (see dev-server.mjs).

import crypto from 'node:crypto';
import { getCart, createCart, saveCart, loadPromo } from './db.js';
import { normalizeItems, priceBag } from './catalog.js';

export const CART_COOKIE = 'ac_cart';
export const CART_HEADER = 'x-cart-id';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

export function newCartId() {
  return `cart_${crypto.randomBytes(16).toString('hex')}`;
}

export function isValidCartId(value) {
  return typeof value === 'string' && /^cart_[a-f0-9]{32}$/.test(value);
}

export function readCookies(req) {
  const header = req.headers.cookie || '';
  const jar = {};
  header.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index === -1) return;
    const name = part.slice(0, index).trim();
    if (!name) return;
    try {
      jar[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      jar[name] = part.slice(index + 1).trim();
    }
  });
  return jar;
}

export function cartCookie(id) {
  return `${CART_COOKIE}=${id}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax`;
}

export function clearCartCookie() {
  return `${CART_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

/**
 * Read (and optionally create) the bag for a request.
 *
 * Returns { cart, items, bag } — `bag` is already priced and includes any
 * promo code that is still valid. `cart` is null when the visitor has no bag.
 */
export async function resolveBag(req, { create = false } = {}) {
  const jar = readCookies(req);
  let cart = null;

  // The cookie is the primary key. Browsers that block cookies (older Safari
  // privacy modes, some webviews) still work: the same random id is echoed to
  // the page in the X-Cart-Id response header and sent back in the request
  // header. Either way it is a 128-bit server-generated secret, and the row
  // must already exist — a made-up id simply gets a fresh empty bag.
  const candidate = isValidCartId(jar[CART_COOKIE]) ? jar[CART_COOKIE] : isValidCartId(req.headers[CART_HEADER]) ? req.headers[CART_HEADER] : null;
  if (candidate) cart = await getCart(candidate);
  if (!cart && create) cart = await createCart({ id: newCartId(), items: [], promoCode: null });
  if (!cart) return { cart: null, items: [], bag: null };

  const { items } = normalizeItems(cart.items || []);
  const promoRow = cart.promo_code ? await loadPromo(cart.promo_code) : null;
  const bag = priceBag(items, { promoCode: cart.promo_code, promoRow });

  return { cart, items, bag };
}

export { saveCart, loadPromo };
