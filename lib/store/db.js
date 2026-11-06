// Storage layer for the store.
//
// Production uses Supabase (the same project as the course). For local work —
// `npm run dev` without Supabase credentials, or a sandbox with no outbound
// network — set STORE_LOCAL_DB=1 (the dev server does this automatically when
// SUPABASE_URL is missing) and the store runs against a small JSON file in
// .tmp/store-db.json instead. Same API either way, so nothing above this file
// knows which one is in play.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { supabase } from '../supabase.js';

const LOCAL = process.env.STORE_LOCAL_DB === '1' || !process.env.SUPABASE_URL;
const LOCAL_FILE = path.resolve(process.cwd(), '.tmp/store-db.json');

/* ── tiny JSON store ───────────────────────────────────────────────────── */

function readLocal() {
  try {
    return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
  } catch {
    return { carts: {}, orders: {}, sessions: {}, promos: {}, subscribers: {}, carts_created: 0 };
  }
}

function writeLocal(db) {
  fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_FILE, JSON.stringify(db, null, 2));
}

function localSeedPromo(db) {
  if (!db.promos.WELCOME10) {
    db.promos.WELCOME10 = {
      code: 'WELCOME10',
      kind: 'percent',
      value: 10,
      description: '10% off your first order',
      active: true,
      min_subtotal_cents: 0,
      max_uses: null,
      times_used: 0,
      starts_at: null,
      ends_at: null,
      created_at: new Date().toISOString(),
    };
  }
  return db;
}

/** Used by tests and the dev server console. */
export function resetLocalDb() {
  if (!LOCAL) return;
  writeLocal(localSeedPromo({ carts: {}, orders: {}, sessions: {}, promos: {}, subscribers: {}, carts_created: 0 }));
}

/* ── carts ─────────────────────────────────────────────────────────────── */

export async function getCart(id) {
  if (LOCAL) {
    const db = readLocal();
    return db.carts[id] || null;
  }
  const { data, error } = await supabase.from('store_carts').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function createCart({ id, items = [], promoCode = null }) {
  if (LOCAL) {
    const db = readLocal();
    const cart = { id, items, promo_code: promoCode, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    db.carts[id] = cart;
    db.carts_created = (db.carts_created || 0) + 1;
    writeLocal(db);
    return cart;
  }
  const { data, error } = await supabase.from('store_carts').insert({ id, items, promo_code: promoCode }).select('*').single();
  if (error) throw error;
  return data;
}

export async function saveCart(id, { items, promoCode }) {
  if (LOCAL) {
    const db = readLocal();
    const cart = db.carts[id];
    if (!cart) return null;
    if (items !== undefined) cart.items = items;
    if (promoCode !== undefined) cart.promo_code = promoCode;
    cart.updated_at = new Date().toISOString();
    writeLocal(db);
    return cart;
  }
  const payload = { updated_at: new Date().toISOString() };
  if (items !== undefined) payload.items = items;
  if (promoCode !== undefined) payload.promo_code = promoCode;
  const { data, error } = await supabase.from('store_carts').update(payload).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  return data;
}

/* ── promo codes ───────────────────────────────────────────────────────── */

export async function loadPromo(code) {
  if (!code) return null;
  const normalized = String(code).trim().toUpperCase();
  if (LOCAL) {
    const db = localSeedPromo(readLocal());
    writeLocal(db);
    return db.promos[normalized] || null;
  }
  const { data, error } = await supabase.from('store_promo_codes').select('*').eq('code', normalized).maybeSingle();
  if (error) return null;
  return data || null;
}

export async function incrementPromoUse(code) {
  if (!code) return;
  if (LOCAL) {
    const db = readLocal();
    const promo = db.promos[code];
    if (promo) promo.times_used = (promo.times_used || 0) + 1;
    writeLocal(db);
    return;
  }
  const { data } = await supabase.from('store_promo_codes').select('code, times_used').eq('code', code).maybeSingle();
  if (data) await supabase.from('store_promo_codes').update({ times_used: (data.times_used || 0) + 1 }).eq('code', code);
}

/* ── orders ────────────────────────────────────────────────────────────── */

export async function findOrderBySession(sessionId) {
  if (!sessionId) return null;
  if (LOCAL) {
    const db = readLocal();
    return db.orders[sessionId] || null;
  }
  const { data, error } = await supabase.from('store_orders').select('*').eq('stripe_session_id', sessionId).maybeSingle();
  if (error) return null;
  return data || null;
}

/** Idempotent: a retried webhook returns the row that already exists. */
export async function insertOrder(record) {
  if (LOCAL) {
    const db = readLocal();
    if (db.orders[record.stripe_session_id]) return { order: db.orders[record.stripe_session_id], created: false };
    const order = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...record };
    db.orders[record.stripe_session_id] = order;
    writeLocal(db);
    return { order, created: true };
  }
  const { data, error } = await supabase.from('store_orders').insert(record).select('*').single();
  if (error) {
    if (error.code === '23505') {
      const existing = await findOrderBySession(record.stripe_session_id);
      if (existing) return { order: existing, created: false };
    }
    throw error;
  }
  return { order: data, created: true };
}

export async function listOrders({ limit = 100 } = {}) {
  if (LOCAL) {
    const db = readLocal();
    return Object.values(db.orders)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit);
  }
  const { data, error } = await supabase.from('store_orders').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

/**
 * Move one order to a new fulfilment status (the admin order book).
 * Returns the updated row, or null when the id doesn't match anything.
 */
export async function updateOrderStatus(id, status) {
  if (LOCAL) {
    const db = readLocal();
    const entry = Object.entries(db.orders).find(([, order]) => order.id === id);
    if (!entry) return null;
    const [sessionId, order] = entry;
    db.orders[sessionId] = { ...order, status };
    writeLocal(db);
    return db.orders[sessionId];
  }
  const { data, error } = await supabase.from('store_orders').update({ status }).eq('id', id).select('*');
  if (error) throw error;
  return data && data.length ? data[0] : null;
}

/* ── checkout sessions (reconciliation) ────────────────────────────────── */

/** Record a paid order from a Checkout Session (used by the webhook and dev). */
export async function recordPaidOrder(record) {
  return insertOrder(record);
}

export async function recordCheckoutSession(record) {
  if (LOCAL) {
    const db = readLocal();
    db.sessions[record.stripe_session_id] = { ...record, created_at: new Date().toISOString(), status: 'open' };
    writeLocal(db);
    return;
  }
  await supabase.from('store_checkout_sessions').insert(record);
}

export async function markSessionExpired(sessionId) {
  if (LOCAL) {
    const db = readLocal();
    if (db.sessions[sessionId]) db.sessions[sessionId].status = 'expired';
    writeLocal(db);
    return;
  }
  await supabase.from('store_checkout_sessions').update({ status: 'expired' }).eq('stripe_session_id', sessionId);
}

/* ── newsletter + contact ──────────────────────────────────────────────── */

export async function addSubscriber({ email, source }) {
  const normalized = String(email).toLowerCase().trim();
  if (LOCAL) {
    const db = readLocal();
    db.subscribers[normalized] = { email: normalized, source, subscribed_at: new Date().toISOString(), unsubscribed_at: null };
    writeLocal(db);
    return;
  }
  const { error } = await supabase
    .from('store_subscribers')
    .upsert({ email: normalized, source, unsubscribed_at: null }, { onConflict: 'email' });
  if (error) throw error;
}

export async function logContactMessage({ firstName, lastName, email, subject, message }) {
  if (LOCAL) {
    const db = readLocal();
    db.messages = db.messages || [];
    db.messages.push({ firstName, lastName, email, subject, message, created_at: new Date().toISOString() });
    writeLocal(db);
    return;
  }
  const { error } = await supabase.from('contact_messages').insert({ first_name: firstName, last_name: lastName, email, subject, message });
  if (error) console.error('[store] contact log failed', error.message);
}

export const isLocalMode = () => LOCAL;

/* ── products & settings (v15) ──────────────────────────────────────────── */
//
// The catalogue used to be a deploy-time JSON file. It is now data, so the
// admin can change a price without a redeploy. Both readers return null when
// the tables are empty or missing, which lets lib/store/catalog.js fall back to
// store/catalog.json — a fresh deploy against an unmigrated database still
// serves a working store rather than an empty one.

export async function listProducts() {
  if (LOCAL) {
    let db = readLocal();
    // Seed from the built catalogue the first time, so `npm run dev` exercises
    // the same database path production uses instead of silently falling back
    // to the JSON file.
    if (!db.products || !Object.keys(db.products).length) {
      try {
        const catalogPath = path.resolve(process.cwd(), 'store/catalog.json');
        const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
        seedLocalProducts((raw.products || []).map((product, index) => ({
          id: product.id,
          name: product.name,
          short_name: product.shortName || product.name,
          subtitle: product.subtitle || '',
          description: product.description || '',
          details: product.details || [],
          fit: product.fit || '',
          badge: product.badge || '',
          category: product.category || '',
          type: product.type || 'custom',
          price_cents: Math.round(Number(product.price) * 100),
          compare_at_cents: null,
          cost_cents: null,
          colors: product.colors || [],
          sizes: product.sizes || [],
          images: product.images || {},
          back_images: product.backImages || {},
          max_per_order: 20,
          in_stock: true,
          sort_order: index + 1,
          supplier: null,
          supplier_variants: {},
        })));
        db = readLocal();
      } catch {
        return null;
      }
    }
    if (!db.products || !Object.keys(db.products).length) return null;
    return Object.values(db.products).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }
  const { data, error } = await supabase.from('store_products').select('*').order('sort_order', { ascending: true });
  if (error) {
    if (/does not exist|schema cache/i.test(error.message || '')) return null; // not migrated yet
    throw new Error(`store_products: ${error.message}`);
  }
  return data && data.length ? data : null;
}

export async function updateProduct(id, patch) {
  const clean = { ...patch, updated_at: new Date().toISOString() };
  if (LOCAL) {
    const db = readLocal();
    const current = (db.products || {})[id];
    if (!current) return null;
    db.products = db.products || {};
    db.products[id] = { ...current, ...clean };
    writeLocal(db);
    return db.products[id];
  }
  const { data, error } = await supabase.from('store_products').update(clean).eq('id', id).select().maybeSingle();
  if (error) throw new Error(`store_products update: ${error.message}`);
  return data || null;
}

export async function getSettings() {
  if (LOCAL) {
    const db = readLocal();
    return db.settings || null;
  }
  const { data, error } = await supabase.from('store_settings').select('*').eq('id', 1).maybeSingle();
  if (error) {
    if (/does not exist|schema cache/i.test(error.message || '')) return null;
    throw new Error(`store_settings: ${error.message}`);
  }
  return data || null;
}

export async function updateSettings(patch) {
  const clean = { ...patch, updated_at: new Date().toISOString() };
  if (LOCAL) {
    const db = readLocal();
    db.settings = { ...(db.settings || { id: 1, shipping_fee_cents: 600, free_shipping_cents: 7500 }), ...clean };
    writeLocal(db);
    return db.settings;
  }
  const { data, error } = await supabase.from('store_settings').update(clean).eq('id', 1).select().maybeSingle();
  if (error) throw new Error(`store_settings update: ${error.message}`);
  return data || null;
}

/** Seed the local JSON db from store/catalog.json so `npm run dev` has products. */
export function seedLocalProducts(rows) {
  if (!LOCAL) return;
  const db = readLocal();
  if (db.products && Object.keys(db.products).length) return;
  db.products = Object.fromEntries(rows.map((row) => [row.id, row]));
  writeLocal(db);
}
