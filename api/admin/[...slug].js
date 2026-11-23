// Consolidated Admin API — replaces 15 separate files (auth, account,
// change-password, send-verification, verify-email, overview, messages,
// lessons, resources, site-content, announcements, revoke, reset-device,
// device-requests, upload-maestro-photo) with one function, for the same
// reason as the other [...slug] files: Vercel's Hobby plan caps a
// project at 12 serverless functions total, and this project grew past
// that. Every URL your admin panel already calls (/api/admin/auth,
// /api/admin/lessons, etc.) is unchanged — this file catches all of them.
//
// `auth` and `verify-email` are intentionally NOT gated by requireAdmin,
// since those are how you get a token in the first place / a link
// clicked from email — everything else requires a valid admin token.

import { requireAdmin } from '../../lib/requireAdmin.js';
import { supabase } from '../../lib/supabase.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { sendAdminVerificationEmail, sendGeneratedCodeEmail, sendGeneratedCodeBatchEmail } from '../../lib/email.js';
import { generateAccessCode } from '../../lib/generateCode.js';
import { listOrders as listStoreOrders, updateOrderStatus as updateStoreOrderStatus,
         listProducts, updateProduct, createProduct, getSettings, updateSettings,
         getDecorationSettings, setDecorationSettings } from '../../lib/store/db.js';
import { clearCatalogCache, refreshCatalog } from '../../lib/store/catalog.js';
import { buildSyncPlan } from '../../lib/store/sync.js';
import { planCreation, applyCreation, loadManifest } from '../../lib/store/create-products.js';
import { planReplace } from '../../lib/store/replace.js';
import { applyReplace } from '../../lib/store/apply-replace.js';
import { submitToSupplier, supplierStatus, cancelFulfilment } from '../../lib/store/fulfilment.js';
import { health as printfulHealth, cancelOrder as cancelSupplierOrder,
         listSyncProducts, suggestMapping, getWebhook, setWebhook, webhookUrl,
         WEBHOOK_EVENTS, createSyncProduct, listVariantMockups,
         createMockupTask } from '../../lib/suppliers/printful.js';
import { health as printkkHealth } from '../../lib/suppliers/printkk.js';
import { findOrderByNumber } from '../../lib/store/db.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { resolveColourName } from '../../lib/store/colour-names.js';

export const config = {
  api: { bodyParser: { sizeLimit: '6mb' } },
};

const VALID_INSTRUMENTS = ['vihuela', 'guitarra', 'guitarra-de-golpe', 'guitarron'];
const VALID_SECTIONS = ['etude', 'practice_technique', 'performance'];
const INSTRUMENT_DISPLAY = { vihuela: 'Vihuela', guitarra: 'Guitarra', 'guitarra-de-golpe': 'Guitarra de Golpe', guitarron: 'Guitarrón' };
const SECTION_DISPLAY = { etude: 'etude', practice_technique: 'practice technique lesson', performance: 'performance track' };

// Which storefront renderer a new product gets. `type` drives both the image
// path and the sizing UI, and the frontend only knows these five (see the image
// map in store/frontend.bundle.js) — an unknown type falls back to the
// "add your product photo" placeholder rather than breaking.
function typeFor(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('cap') || n.includes('hat') || n.includes('beanie')) return 'cap';
  if (n.includes('hoodie')) return 'hoodie';
  if (n.includes('windbreaker') || n.includes('jacket')) return 'windbreaker';
  if (n.includes('tee') || n.includes('shirt') || n.includes('t-shirt')) return 'tee';
  if (n.includes('pick')) return 'picks';
  if (n.includes('sticker')) return 'stickers';
  return 'custom';
}

export default async function handler(req, res) {
  // Derive the route from the URL path (e.g. /api/admin/lessons -> "lessons")
  // rather than relying solely on Vercel's dynamic-route query population.
  const urlParts = req.url.split('?')[0].split('/').filter(Boolean); // ['api', 'admin', 'lessons']
  const route = urlParts[2];

  // ══════════════ Public (no admin token required) ══════════════

  // ── /api/admin/auth ──
  if (route === 'auth') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { password } = req.body || {};
    if (!password) return res.status(401).json({ error: 'Incorrect password.' });

    const { data: existing, error } = await supabase.from('admin_account').select('*').maybeSingle();
    if (error) { console.error(error); return res.status(500).json({ error: 'Something went wrong. Please try again.' }); }

    let account = existing;
    if (!account) {
      if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Incorrect password.' });
      }
      const { data: created, error: createErr } = await supabase.from('admin_account').insert({
        name: 'Isaak Matovich',
        login_email: process.env.FROM_EMAIL?.match(/<(.+)>/)?.[1] || 'maestro.armoniaconnect@gmail.com',
        password_hash: hashPassword(password),
      }).select().single();
      if (createErr) { console.error(createErr); return res.status(500).json({ error: 'Could not set up your admin account. Please try again.' }); }
      account = created;
    } else {
      if (!verifyPassword(password, account.password_hash)) return res.status(401).json({ error: 'Incorrect password.' });
    }

    const token = jwt.sign({ admin: true, adminId: account.id }, process.env.SESSION_SECRET, { expiresIn: '7d' });
    return res.status(200).json({ token });
  }

  // ── /api/admin/verify-email ──
  if (route === 'verify-email') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const token = (req.body?.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Missing verification token.' });

    const { data: account, error } = await supabase.from('admin_account').select('*').maybeSingle();
    if (error || !account) return res.status(404).json({ error: 'Account not found.' });
    if (!account.verification_token || account.verification_token !== token) {
      return res.status(400).json({ error: 'This verification link is invalid. Request a new one from Settings.' });
    }
    if (new Date(account.verification_token_expires) < new Date()) {
      return res.status(400).json({ error: 'This verification link has expired. Request a new one from Settings.' });
    }
    const { error: updateErr } = await supabase.from('admin_account').update({ login_email_verified: true, verification_token: null, verification_token_expires: null }).eq('id', account.id);
    if (updateErr) { console.error(updateErr); return res.status(500).json({ error: 'Could not verify. Please try again.' }); }
    return res.status(200).json({ ok: true });
  }

  // ══════════════ Everything below requires a valid admin token ══════════════
  const admin = requireAdmin(req);
  if (admin.error) return res.status(admin.status).json({ error: admin.error });

  // ── /api/admin/account ──
  if (route === 'account') {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('admin_account').select('*').maybeSingle();
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not load your account.' }); }
      if (!data) return res.status(404).json({ error: 'No admin account found yet — log in once to create it.' });
      return res.status(200).json({ id: data.id, name: data.name, loginEmail: data.login_email, loginEmailVerified: data.login_email_verified, billingEmail: data.billing_email, createdAt: data.created_at });
    }
    if (req.method === 'PATCH') {
      const { name, loginEmail, billingEmail } = req.body || {};
      const update = { updated_at: new Date().toISOString() };
      if (name !== undefined) update.name = name;
      if (billingEmail !== undefined) update.billing_email = billingEmail;
      if (loginEmail !== undefined) {
        const { data: current } = await supabase.from('admin_account').select('login_email').maybeSingle();
        update.login_email = loginEmail;
        if (current && current.login_email !== loginEmail) {
          update.login_email_verified = false;
          update.verification_token = null;
          update.verification_token_expires = null;
        }
      }
      const { error } = await supabase.from('admin_account').update(update).not('id', 'is', null);
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not save changes.' }); }
      if (name !== undefined) {
        await supabase.from('site_content').upsert({ key: 'maestro.name', value: name, updated_at: new Date().toISOString() });
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── /api/admin/change-password ──
  if (route === 'change-password') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are both required.' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    const { data: account, error } = await supabase.from('admin_account').select('*').maybeSingle();
    if (error || !account) { console.error(error); return res.status(500).json({ error: 'Could not load your account.' }); }
    if (!verifyPassword(currentPassword, account.password_hash)) return res.status(401).json({ error: 'Current password is incorrect.' });
    const { error: updateErr } = await supabase.from('admin_account').update({ password_hash: hashPassword(newPassword), updated_at: new Date().toISOString() }).eq('id', account.id);
    if (updateErr) { console.error(updateErr); return res.status(500).json({ error: 'Could not update your password. Please try again.' }); }
    return res.status(200).json({ ok: true });
  }

  // ── /api/admin/send-verification ──
  if (route === 'send-verification') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { data: account, error } = await supabase.from('admin_account').select('*').maybeSingle();
    if (error || !account) { console.error(error); return res.status(500).json({ error: 'Could not load your account.' }); }
    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { error: updateErr } = await supabase.from('admin_account').update({ verification_token: token, verification_token_expires: expires }).eq('id', account.id);
    if (updateErr) { console.error(updateErr); return res.status(500).json({ error: 'Could not start verification.' }); }
    const siteUrl = process.env.SITE_URL || 'https://armoniaconnect.com';
    const verifyUrl = `${siteUrl}/admin/verify.html?token=${token}`;
    try {
      await sendAdminVerificationEmail({ to: account.login_email, verifyUrl });
    } catch (err) {
      console.error('Verification email send error:', err);
      return res.status(500).json({ error: 'Could not send the verification email. Please try again.' });
    }
    return res.status(200).json({ ok: true });
  }

  // ── /api/admin/overview ──
  if (route === 'overview') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const { data: codes, error: codesError } = await supabase.from('access_codes').select('code, email, created_at, redeemed_count, last_login_at, revoked, bound_device_id, bound_at, code_type, source').order('created_at', { ascending: false });
    if (codesError) { console.error('Admin overview codes error:', codesError); return res.status(500).json({ error: 'Could not load students.' }); }
    const { data: profiles } = await supabase.from('student_profiles').select('*');
    const { data: unread } = await supabase.from('messages').select('code').eq('sender', 'student').eq('read_by_maestro', false);
    const unreadCounts = {};
    (unread || []).forEach((m) => { unreadCounts[m.code] = (unreadCounts[m.code] || 0) + 1; });
    // Latest message per conversation, for the admin message hub. Ordering
    // desc + keeping only the first hit per code gives us "most recent" cheaply
    // without a separate query per student.
    const { data: recentMessages } = await supabase.from('messages').select('code, sender, body, created_at').order('created_at', { ascending: false }).limit(500);
    const lastMessageByCode = {};
    (recentMessages || []).forEach((m) => { if (!lastMessageByCode[m.code]) lastMessageByCode[m.code] = m; });
    const profileByCode = {};
    (profiles || []).forEach((p) => { profileByCode[p.code] = p; });
    const students = codes.map((c) => ({
      ...c,
      profile: profileByCode[c.code] || null,
      unreadCount: unreadCounts[c.code] || 0,
      lastMessage: lastMessageByCode[c.code]
        ? { body: lastMessageByCode[c.code].body, sender: lastMessageByCode[c.code].sender, createdAt: lastMessageByCode[c.code].created_at }
        : null,
    }));
    return res.status(200).json({ students });
  }

  // ── /api/admin/messages ──
  if (route === 'messages') {
    if (req.method === 'GET') {
      const code = (req.query.code || '').trim().toUpperCase();
      if (!code) return res.status(400).json({ error: 'code query param required.' });
      const { data, error } = await supabase.from('messages').select('id, sender, body, created_at').eq('code', code).order('created_at', { ascending: true }).limit(200);
      if (error) { console.error('Admin messages fetch error:', error); return res.status(500).json({ error: 'Could not load thread.' }); }
      await supabase.from('messages').update({ read_by_maestro: true }).eq('code', code).eq('sender', 'student').eq('read_by_maestro', false);
      return res.status(200).json({ messages: data });
    }
    if (req.method === 'POST') {
      const code = (req.body?.code || '').trim().toUpperCase();
      const body = (req.body?.body || '').trim();
      if (!code || !body) return res.status(400).json({ error: 'code and body are required.' });
      const { error } = await supabase.from('messages').insert({ code, sender: 'maestro', body });
      if (error) { console.error('Admin message send error:', error); return res.status(500).json({ error: 'Could not send reply.' }); }
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── /api/admin/lessons ──
  if (route === 'lessons') {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('lessons').select('*').order('instrument_key', { ascending: true }).order('section', { ascending: true }).order('sort_order', { ascending: true });
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not load lessons.' }); }
      return res.status(200).json({ lessons: data });
    }
    if (req.method === 'POST') {
      const { instrumentKey, section, title, description, videoUrl, soundsliceId, sortOrder, coverImageUrl } = req.body || {};
      if (!VALID_INSTRUMENTS.includes(instrumentKey)) return res.status(400).json({ error: 'Invalid instrument.' });
      if (!VALID_SECTIONS.includes(section)) return res.status(400).json({ error: 'Invalid section.' });
      if (!title) return res.status(400).json({ error: 'Title is required.' });
      const { data, error } = await supabase.from('lessons').insert({ instrument_key: instrumentKey, section, title, description: description || null, video_url: videoUrl || null, soundslice_id: soundsliceId || null, sort_order: sortOrder || 0, cover_image_url: coverImageUrl || null }).select().single();
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not create lesson.' }); }

      // Auto-draft a course update. It sits as 'pending' until an admin
      // reviews and publishes it — students never see it until then.
      const autoTitle = `New ${SECTION_DISPLAY[section]} added: ${INSTRUMENT_DISPLAY[instrumentKey]}`;
      const autoBody = `"${title}" was just added to the ${INSTRUMENT_DISPLAY[instrumentKey]} course library.`;
      await supabase.from('course_updates').insert({ title: autoTitle, body: autoBody, status: 'pending', source: 'auto', related_lesson_id: data.id });

      return res.status(200).json({ lesson: data });
    }
    if (req.method === 'PATCH') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id query param required.' });
      const { title, description, videoUrl, soundsliceId, sortOrder, section, instrumentKey, coverImageUrl } = req.body || {};
      const update = { updated_at: new Date().toISOString() };
      if (title !== undefined) update.title = title;
      if (description !== undefined) update.description = description;
      if (videoUrl !== undefined) update.video_url = videoUrl;
      if (soundsliceId !== undefined) update.soundslice_id = soundsliceId;
      if (sortOrder !== undefined) update.sort_order = sortOrder;
      if (section !== undefined) update.section = section;
      if (instrumentKey !== undefined) update.instrument_key = instrumentKey;
      if (coverImageUrl !== undefined) update.cover_image_url = coverImageUrl;
      const { data, error } = await supabase.from('lessons').update(update).eq('id', id).select().single();
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not update lesson.' }); }
      return res.status(200).json({ lesson: data });
    }
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id query param required.' });
      const { error } = await supabase.from('lessons').delete().eq('id', id);
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not delete lesson.' }); }
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── /api/admin/resources ──
  if (route === 'resources') {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('resources').select('*').order('kind').order('sort_order');
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not load resources.' }); }
      return res.status(200).json({ resources: data });
    }
    if (req.method === 'POST') {
      const { kind, title, fileUrl, sortOrder } = req.body || {};
      if (!['chord_book', 'midi_track', 'sheet_music'].includes(kind)) return res.status(400).json({ error: 'Invalid kind.' });
      if (!title) return res.status(400).json({ error: 'Title is required.' });
      const { data, error } = await supabase.from('resources').insert({ kind, title, file_url: fileUrl || null, sort_order: sortOrder || 0 }).select().single();
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not create resource.' }); }
      return res.status(200).json({ resource: data });
    }
    if (req.method === 'PATCH') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id query param required.' });
      const { title, fileUrl, sortOrder } = req.body || {};
      const update = {};
      if (title !== undefined) update.title = title;
      if (fileUrl !== undefined) update.file_url = fileUrl;
      if (sortOrder !== undefined) update.sort_order = sortOrder;
      const { data, error } = await supabase.from('resources').update(update).eq('id', id).select().single();
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not update resource.' }); }
      return res.status(200).json({ resource: data });
    }
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id query param required.' });
      const { error } = await supabase.from('resources').delete().eq('id', id);
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not delete resource.' }); }
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── /api/admin/upload-resource ──
  // Uploads a chord book PDF or short audio/MIDI file directly, returning
  // a public URL to paste into a resource's File URL field. Capped at 3MB
  // raw (works well for PDFs) because Vercel's serverless functions have a
  // hard ~4.5MB request size limit that no config can override — a 3MB
  // file becomes about 4MB once base64-encoded for transport, which stays
  // safely under that ceiling.
  //
  // For larger files (most backing-track audio, some longer PDFs), upload
  // directly through the Supabase dashboard instead — Storage → the
  // course-resources bucket → Upload file — then copy the public URL it
  // gives you into the File URL field here. That path has no size limit
  // since the file never passes through this function.
  if (route === 'upload-resource') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { fileBase64, contentType, fileName } = req.body || {};
    if (!fileBase64) return res.status(400).json({ error: 'No file provided.' });

    const allowed = ['application/pdf', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/midi', 'audio/x-midi', 'audio/mp4'];
    if (!allowed.includes(contentType)) {
      return res.status(400).json({ error: 'Please upload a PDF, MP3, WAV, or MIDI file.' });
    }

    try {
      const buffer = Buffer.from(fileBase64.split(',').pop(), 'base64');
      if (buffer.length > 3 * 1024 * 1024) {
        return res.status(400).json({
          error: 'This file is over 3MB, which is too large to upload through this form. Upload it directly via the Supabase dashboard instead (Storage → course-resources → Upload file), then paste the resulting URL into the File URL field.',
        });
      }
      const safeName = (fileName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from('course-resources').upload(path, buffer, { contentType, upsert: true });
      if (uploadError) throw uploadError;
      const { data: publicUrlData } = supabase.storage.from('course-resources').getPublicUrl(path);
      return res.status(200).json({ url: publicUrlData.publicUrl });
    } catch (err) {
      console.error('Resource upload error:', err);
      return res.status(500).json({ error: 'Could not upload the file. Please try again.' });
    }
  }

  // ── /api/admin/site-content ──
  if (route === 'site-content') {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('site_content').select('*').order('key');
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not load site content.' }); }
      return res.status(200).json({ content: data });
    }
    if (req.method === 'PATCH') {
      const { key, value } = req.body || {};
      if (!key || value === undefined) return res.status(400).json({ error: 'key and value are required.' });
      const { error } = await supabase.from('site_content').upsert({ key, value, updated_at: new Date().toISOString() });
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not save.' }); }
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── /api/admin/store-orders ──
  // The store's order book: every paid order, newest first, with the numbers
  // that matter for fulfilment (what to pack, where to send it, what was paid).
  if (route === 'store-orders') {
    if (req.method === 'GET') {
      try {
        const orders = await listStoreOrders({ limit: Math.min(500, Number(req.query.limit) || 200) });
        return res.status(200).json({ orders });
      } catch (err) {
        console.error('Store orders fetch error:', err);
        return res.status(500).json({ error: 'Could not load store orders.' });
      }
    }
    if (req.method === 'PATCH') {
      const { id, status } = req.body || {};
      const allowed = ['paid', 'packed', 'shipped', 'refunded', 'cancelled'];
      // "undefined"/"null" arrive as strings from the admin UI when an order row
      // is missing its id — they are truthy, so guard them explicitly rather
      // than reporting a successful update that matched no rows.
      const validId = typeof id === 'string' && /^[0-9a-fA-F-]{8,64}$/.test(id);
      if (!validId || !allowed.includes(status)) {
        return res.status(400).json({ error: 'A valid order id and status are required.' });
      }
      try {
        const updated = await updateStoreOrderStatus(id, status);
        if (!updated) return res.status(404).json({ error: 'That order no longer exists.' });

        // A refund or cancellation has to reach the supplier too, or the parcel
        // is still printed and shipped after the money went back. The order is
        // already updated at this point, so a supplier failure is reported
        // rather than rolled back — silently ignoring it is the one thing we
        // cannot do, because it costs real money per order.
        let supplier = null;
        if (status === 'refunded' || status === 'cancelled') {
          supplier = await cancelFulfilment(updated).catch((err) => ({ failed: [{ error: err.message }] }));
        }

        return res.status(200).json({ ok: true, id, status, supplier });
      } catch (error) {
        console.error('Store order update error:', error);
        return res.status(500).json({ error: 'Could not update the order.' });
      }
    }
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // ── /api/admin/store-products ──
  // The product + price editor. This is the write path for everything the store
  // sells, so every field is validated here rather than trusted from the form:
  // the admin UI is the only caller today, but a wrong price_cents is a real
  // charge, and a wrong colours array is a product nobody can add to a bag.
  if (route === 'store-products') {
    if (req.method === 'GET') {
      try {
        const [rows, settings] = await Promise.all([listProducts(), getSettings()]);
        return res.status(200).json({
          products: rows || [],
          settings: settings || { shipping_fee_cents: 600, free_shipping_cents: 7500 },
          migrated: Boolean(rows && rows.length),
        });
      } catch (err) {
        console.error('Store products fetch error:', err);
        return res.status(500).json({ error: 'Could not load store products.' });
      }
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) return res.status(400).json({ error: 'A product id is required.' });

      const patch = {};
      const fail = (message) => res.status(400).json({ error: message });

      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) return fail('A product needs a name.');
        if (name.length > 120) return fail('That name is too long.');
        patch.name = name;
      }
      if (body.shortName !== undefined) patch.short_name = String(body.shortName).trim().slice(0, 60) || null;
      if (body.subtitle !== undefined) patch.subtitle = String(body.subtitle).trim().slice(0, 160) || null;
      if (body.description !== undefined) patch.description = String(body.description).trim().slice(0, 2000) || null;
      if (body.fit !== undefined) patch.fit = String(body.fit).trim().slice(0, 600) || null;
      if (body.badge !== undefined) patch.badge = String(body.badge).trim().slice(0, 60) || null;
      if (body.category !== undefined) patch.category = String(body.category).trim().slice(0, 60) || null;

      if (body.priceCents !== undefined) {
        const cents = Number(body.priceCents);
        if (!Number.isInteger(cents) || cents < 50 || cents > 500000) {
          return fail('Price must be a whole number of cents between 50 and 500,000.');
        }
        patch.price_cents = cents;
      }
      if (body.costCents !== undefined) {
        if (body.costCents === null || body.costCents === '') patch.cost_cents = null;
        else {
          const cost = Number(body.costCents);
          if (!Number.isInteger(cost) || cost < 0 || cost > 500000) return fail('Cost must be a whole number of cents.');
          patch.cost_cents = cost;
        }
      }
      if (body.compareAtCents !== undefined) {
        if (body.compareAtCents === null || body.compareAtCents === '') patch.compare_at_cents = null;
        else {
          const cmp = Number(body.compareAtCents);
          if (!Number.isInteger(cmp) || cmp < 0) return fail('Compare-at price must be a whole number of cents.');
          patch.compare_at_cents = cmp;
        }
      }

      if (body.colors !== undefined) {
        if (!Array.isArray(body.colors) || body.colors.length === 0) return fail('A product needs at least one colour.');
        const colors = body.colors.map((c) => String(c).trim()).filter(Boolean);
        if (colors.length !== body.colors.length) return fail('Colour keys cannot be blank.');
        // A colour key is also the label AND the `productId|color|size` half of
        // the supplier mapping. Printful reports "Navy Blue"; a key of
        // "navy-blue" would never match the order line, so the product would
        // sell and then never ship. Canonicalise to Printful's spelling on the
        // way in, so the admin cannot reintroduce the mismatch by typing.
        const canonical = [];
        for (const colour of colors) {
          const resolved = resolveColourName(colour);
          if (resolved && !canonical.includes(resolved.name)) canonical.push(resolved.name);
          else if (!resolved && !canonical.includes(colour)) canonical.push(colour);
        }
        patch.colors = canonical;
      }
      if (body.sizes !== undefined) {
        if (!Array.isArray(body.sizes) || body.sizes.length === 0) return fail('A product needs at least one size.');
        patch.sizes = body.sizes.map((x) => String(x).trim()).filter(Boolean);
      }
      if (body.details !== undefined) {
        if (!Array.isArray(body.details)) return fail('Details must be a list.');
        patch.details = body.details.map((d) => String(d).trim()).filter(Boolean).slice(0, 20);
      }
      if (body.images !== undefined) {
        if (typeof body.images !== 'object' || body.images === null) return fail('Images must be an object of colour → path.');
        const images = {};
        for (const [color, path] of Object.entries(body.images)) {
          if (!path) continue;
          const value = String(path);
          // Three legitimate sources: a file in this repo, a Printful mockup on
          // their CDN, and a photo uploaded to our own storage bucket. The old
          // check allowed only the first, so an uploaded photo — and every
          // synced mockup — was rejected with "must be a path under
          // /store/images/". The storefront needs https for Stripe anyway.
          const localPath = /^\/store\/images\/[A-Za-z0-9._-]+$/.test(value);
          const remote = /^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9._\/-]*[A-Za-z0-9]$/.test(value);
          if (!localPath && !remote) {
            return fail(`Image for "${color}" must be a path under /store/images/ or an https URL.`);
          }
          images[color] = value;
        }
        patch.images = images;
      }
      if (body.inStock !== undefined) patch.in_stock = Boolean(body.inStock);

      // The supplier mapping. Keys are "productId|color|size", or
      // "productId|*|*" when one variant covers every colour/size. Values are
      // the supplier's own ids — opaque to us, so they are only checked for
      // shape, never invented.
      if (body.supplier !== undefined) {
        const supplier = body.supplier === null ? null : String(body.supplier).trim();
        if (supplier && !['printful', 'printkk'].includes(supplier)) {
          return fail('Supplier must be printful or printkk.');
        }
        patch.supplier = supplier || null;
      }
      if (body.supplierVariants !== undefined) {
        if (typeof body.supplierVariants !== 'object' || body.supplierVariants === null) {
          return fail('Supplier variants must be an object.');
        }
        const variants = {};
        for (const [key, value] of Object.entries(body.supplierVariants)) {
          if (value === '' || value === null || value === undefined) continue;
          if (!/^[A-Za-z0-9-]+\|(\*|[A-Za-z0-9 .&-]+)\|(\*|[A-Za-z0-9 .&-]+)$/.test(key)) {
            return fail(`"${key}" is not a valid variant key (expected product|colour|size).`);
          }
          const id = String(value).trim();
          if (!/^[0-9]{1,20}$/.test(id)) return fail(`The supplier id for "${key}" must be numeric.`);
          variants[key] = id;
        }
        patch.supplier_variants = variants;
      }

      if (body.sortOrder !== undefined) {
        const order = Number(body.sortOrder);
        if (!Number.isInteger(order) || order < 0) return fail('Sort order must be a whole number.');
        patch.sort_order = order;
      }

      if (!Object.keys(patch).length) return fail('Nothing to update.');

      try {
        const updated = await updateProduct(id, patch);
        if (!updated) {
          return res.status(404).json({
            error: `"${id}" is not in the products table. Run supabase/schema-v15.sql, then reload this panel.`,
          });
        }
        clearCatalogCache(); // the next request must see the new price, not a cached one
        return res.status(200).json({ ok: true, product: updated });
      } catch (err) {
        console.error('Store product update error:', err);
        return res.status(500).json({ error: 'Could not save that product.' });
      }
    }
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // ── /api/admin/store-webhook ──
  // Printful has no webhook screen in its dashboard; the only way to register
  // one is POST /webhooks. So the admin does it, rather than telling the user to
  // go to a page that does not exist.
  //
  // GET   → what Printful currently has, plus the URL we would register
  // POST  → register it (replacing any existing config — Printful allows one)
  if (route === 'store-webhook') {
    // The registered URL must be the canonical production host, never the host
    // this request happened to arrive on. Registering a preview deployment's URL
    // works until that deployment is replaced, then silently stops delivering.
    const canonicalHost = (() => {
      const explicit = process.env.SITE_URL;
      if (explicit) return String(explicit).replace(/\/+$/, '');
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
      if (host.endsWith('.vercel.app')) return 'https://armoniaconnect.com';
      return host ? `https://${host}` : undefined;
    })();

    if (req.method === 'GET') {
      const wanted = webhookUrl(canonicalHost);
      if (!process.env.PRINTFUL_API_TOKEN) {
        return res.status(200).json({ ok: false, reason: 'PRINTFUL_API_TOKEN is not set.', wanted, events: WEBHOOK_EVENTS });
      }
      try {
        const current = await getWebhook();
        const matches = Boolean(current.configured && wanted && current.url === wanted);
        return res.status(200).json({
          ok: matches,
          current: current.configured ? { url: current.url, types: current.types || [] } : null,
          wanted,
          events: WEBHOOK_EVENTS,
          reason: matches
            ? null
            : current.configured
              ? 'Printful is pointing somewhere else, so tracking numbers will not reach the admin.'
              : 'No webhook is configured, so tracking numbers will never arrive.',
        });
      } catch (err) {
        return res.status(502).json({ ok: false, reason: `Could not read webhook settings: ${err.message}`, wanted });
      }
    }

    if (req.method === 'POST') {
      const url = webhookUrl(canonicalHost);
      if (!url) {
        return res.status(400).json({
          error: 'PRINTFUL_WEBHOOK_TOKEN is not set. Add it in Vercel and redeploy — the URL carries it, so there is nothing to register without it.',
        });
      }
      try {
        const result = await setWebhook(url, WEBHOOK_EVENTS);
        console.log('[admin] Printful webhook registered', result.url, WEBHOOK_EVENTS.join(','));
        return res.status(200).json({ ok: true, url: result.url, types: result.types || WEBHOOK_EVENTS });
      } catch (err) {
        return res.status(502).json({ error: `Printful rejected the webhook: ${err.message}` });
      }
    }
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // ── /api/admin/store-reload ──
  // Replaces the storefront catalogue with what is in Printful: names verbatim,
  // Printful's retail prices, Printful's colours, Printful's mockups. This is
  // the only route here that deletes anything.
  //
  // GET  → the plan. No writes.
  // POST → apply it, but only if the caller sends back the fingerprint of the
  //        plan a human reviewed. A plan computed against a store that has
  //        since changed is refused rather than half-applied.
  if (route === 'store-reload') {
    const buildPlan = async () => {
      const [printfulProducts, rows] = await Promise.all([
        listSyncProducts(),
        listProducts().catch(() => []),
      ]);
      const { refreshCatalog } = await import('../../lib/store/catalog.js');
      const cat = await refreshCatalog({ force: true });
      return planReplace(printfulProducts, rows || [], cat.colors || {});
    };

    if (req.method === 'GET') {
      try {
        return res.status(200).json(await buildPlan());
      } catch (err) {
        console.error('Store reload preview error:', err);
        return res.status(502).json({ error: `Could not read your Printful store: ${err.message}` });
      }
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      let plan;
      try {
        plan = await buildPlan();
      } catch (err) {
        return res.status(502).json({ error: `Could not read your Printful store: ${err.message}` });
      }

      if (body.fingerprint && body.fingerprint !== plan.fingerprint) {
        return res.status(409).json({
          error: 'The plan has changed since you looked at it — reload and review it again. Nothing was written.',
          fingerprint: plan.fingerprint,
        });
      }
      if (!body.fingerprint && body.confirm !== true) {
        return res.status(400).json({ error: 'Send the fingerprint of the plan you reviewed, or { confirm: true }.' });
      }
      if (plan.problems.length) {
        return res.status(400).json({
          error: 'Some Printful products could not be read, so nothing was written.',
          problems: plan.problems,
        });
      }

      const result = await applyReplace(plan, { dryRun: body.dryRun === true });
      clearCatalogCache();
      return res.status(200).json({
        ok: result.ok,
        message: result.message || null,
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
        failed: result.failed,
        summary: {
          created: result.created.length,
          updated: result.updated.length,
          deleted: result.deleted.length,
          failed: result.failed.length,
        },
      });
    }
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // ── /api/admin/store-create ──
  // Creates our products IN Printful. A new store starts empty and a sync can
  // only read what exists, so without this the first step is an hour of manual
  // clicking. GET is a dry run: it reports what would be created and what is
  // still missing (normally a blank variant id), and writes nothing.
  if (route === 'store-create') {
    const baseUrl = (() => {
      const explicit = process.env.SITE_URL;
      if (explicit) return String(explicit).replace(/\/+$/, '');
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
      if (host.endsWith('.vercel.app')) return 'https://www.armoniaconnect.com';
      return host ? `https://${host}` : 'https://www.armoniaconnect.com';
    })();

    if (req.method === 'GET') {
      try {
        const existing = await listSyncProducts().catch(() => []);
        const plan = planCreation(loadManifest(), baseUrl, existing.map((p) => p.name));
        return res.status(200).json(plan);
      } catch (err) {
        return res.status(502).json({ error: `Could not read your Printful store: ${err.message}` });
      }
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : null;
      try {
        const existing = await listSyncProducts().catch(() => []);
        const full = planCreation(loadManifest(), baseUrl, existing.map((p) => p.name));
        const plan = ids ? { ...full, ready: full.ready.filter((p) => ids.includes(p.id)) } : full;
        if (!plan.ready.length) {
          return res.status(400).json({
            error: 'Nothing is ready to create. The usual cause is a missing catalogVariantId in store/printful-products.json.',
            blocked: full.blocked,
          });
        }
        const result = await applyCreation(plan, { createProduct: createSyncProduct });
        clearCatalogCache();
        return res.status(200).json({ ok: result.failed.length === 0, ...result, blocked: full.blocked });
      } catch (err) {
        return res.status(502).json({ error: `Printful rejected the request: ${err.message}` });
      }
    }
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // ── /api/admin/store-sync ──
  // Rebuilds colours and sizes from what the Printful store actually contains.
  // GET returns a plan and changes nothing — the diff is the point, because a
  // sync that silently rewrites a live product can remove a colour people are
  // about to buy. POST applies a plan the human has seen.
  if (route === 'store-sync') {
    const buildPlan = async () => {
      const { refreshCatalog } = await import('../../lib/store/catalog.js');
      const cat = await refreshCatalog({ force: true });
      const rows = await listProducts();
      const printfulProducts = await listSyncProducts();
      // Colours live in store/catalog.json, not in a table, so the current map
      // comes from the assembled catalogue.
      return buildSyncPlan(printfulProducts, rows || [], cat.colors || {});
    };

    if (req.method === 'GET') {
      try {
        return res.status(200).json(await buildPlan());
      } catch (err) {
        console.error('Store sync preview error:', err);
        return res.status(502).json({ error: `Could not read your Printful store: ${err.message}` });
      }
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.confirm !== true) {
        return res.status(400).json({ error: 'Send { confirm: true } after reviewing the plan.' });
      }
      // Accepts which product ids to apply. Anything not listed is left alone,
      // so a plan reviewed yesterday cannot surprise-change a product today.
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : null;

      let plan;
      try {
        plan = await buildPlan();   // recomputed, never trusted from the client
      } catch (err) {
        return res.status(502).json({ error: `Could not read your Printful store: ${err.message}` });
      }

      const applied = [];
      const skipped = [];
      const failures = [];
      const existingRows = await listProducts();

      for (const item of plan.products) {
        if (ids && !ids.includes(item.id)) { skipped.push(item.id); continue; }
        const current = existingRows.find((r) => r.id === item.id);

        try {
          if (item.isNew) {
            // Only auto-create what Printful can actually price. A product with
            // no retail price would appear in the store at zero.
            if (!item.priceCents) {
              skipped.push(item.id);
              failures.push({ id: item.id, error: 'Printful returned no price for this product.' });
              continue;
            }
            await createProduct({
              id: item.id,
              name: item.name,
              subtitle: '',
              description: '',
              type: typeFor(item.printfulName),
              priceCents: item.priceCents,
              costCents: null,
              colors: item.colors,
              sizes: item.sizes,
              images: Object.keys(item.images || {}).length
                ? item.images
                : (item.image && item.colors.length ? { [item.colors[0]]: item.image } : {}),
              back_images: {},
              inStock: false,   // never go on sale unannounced
              supplier: 'printful',
              sortOrder: (existingRows.length + applied.length) + 1,
            });
            applied.push({ id: item.id, action: 'created' });
            continue;
          }

          const patch = {};
          if (item.changes.colors) patch.colors = item.changes.colors.to;
          if (item.changes.sizes) patch.sizes = item.changes.sizes.to;
          if (item.changes.supplier) patch.supplier = 'printful';
          // This loop used to live in a branch that also guarded a stray
          // `continue`, which meant a product whose only change was a new
          // Printful mockup was skipped entirely — the images were fetched,
          // then thrown away before the patch was written. Check the images
          // independently of the colour/size changes.
          // The supplier map is what makes an order placeable. It is derived
          // from Printful's own variant ids during the sync, so it cannot be a
          // guess — but it is still merged, so an id someone deliberately
          // remapped in the admin is never clobbered by a routine sync.
          if (item.supplierVariants && Object.keys(item.supplierVariants).length) {
            patch.supplier_variants = { ...(current?.supplier_variants || {}), ...item.supplierVariants };
            patch.supplier = 'printful';
          }
          if (item.images && Object.keys(item.images).length) {
            // Merge rather than replace: a colour Printful gave us no mockup for
            // keeps whatever artwork is already on the storefront. Then drop any
            // Printful-CDN photo Printful no longer offers — that is the old flat
            // artwork file, and leaving it in place is what made the cards look
            // like a design pasted on its own square.
            const merged = { ...(current?.images || {}), ...item.images };
            for (const colour of item.staleImages || []) {
              if (!item.images[colour]) delete merged[colour];
            }
            patch.images = merged;
          } else if (item.image && item.colors && item.colors.length && !Object.keys(current?.images || {}).length) {
            // Printful had no per-variant preview but did give a product
            // thumbnail. Better than a placeholder, and only when we have no
            // artwork at all — never overwriting a photo we already have.
            patch.images = { [item.colors[0]]: item.image };
          }
          // SORT ORDER IS DELIBERATELY NOT TOUCHED. It used to be written from
          // the loop index, so every sync silently reshuffled the shop into
          // Printful's listing order and undid whatever the owner had arranged.
          if (!Object.keys(patch).length) { skipped.push(item.id); continue; }
          void current;
          await updateProduct(item.id, patch);
          applied.push({
            id: item.id,
            action: 'updated',
            keys: Object.keys(patch),
            // Report how many mockups landed. "The sync ran but the photos did
            // not change" has two very different causes — Printful gave us no
            // preview, or we failed to store the ones it gave — and without
            // this count both look identical from the outside.
            photos: patch.images ? Object.keys(patch.images).length : 0,
            photosFromPrintful: Object.keys(item.images || {}).length,
            // How many of this product's colour/size combinations Printful can
            // actually be asked to ship. Zero means the shop can take money and
            // not fulfil, which is worth seeing in the sync result.
            variantsMapped: patch.supplier_variants ? Object.keys(patch.supplier_variants).length : 0,
          });
        } catch (err) {
          failures.push({ id: item.id, error: err.message });
        }
      }

      clearCatalogCache();
      return res.status(200).json({ ok: failures.length === 0, applied, skipped, failures });
    }
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // ── /api/admin/store-variants ──
  // Bridges the gap between "the product is in Printful" and "our order can be
  // fulfilled". Printful mints an opaque sync_variant_id per colour/size that
  // cannot be computed from the catalog id, so this reads the store, proposes a
  // product|colour|size key for every variant, and saves only what a human has
  // confirmed. Nothing is written on GET — a guessed mapping would ship the
  // wrong garment, which costs more than the minute this takes.
  if (route === 'store-variants') {
    if (req.method === 'GET') {
      try {
        const [printfulProducts, ourProducts] = await Promise.all([
          listSyncProducts(),
          listProducts().catch(() => []),
        ]);
        // refreshCatalog(), not loadCatalog(): the sync one always reads
        // store/catalog.json and would hand back colours from the file even
        // after they have been edited in this very panel. The mapper needs the
        // live colour names, because those are the ones orders carry.
        let normalised = [];
        try {
          const { refreshCatalog } = await import('../../lib/store/catalog.js');
          const cat = await refreshCatalog({ force: true });
          normalised = cat.products.map((p) => ({ id: p.id, name: p.name, colors: p.colors, sizes: p.sizes }));
        } catch {
          normalised = (ourProducts || []).map((p) => ({ id: p.id, name: p.name, colors: p.colors || [], sizes: p.sizes || [] }));
        }
        const suggestions = suggestMapping(printfulProducts, normalised);
        const alreadyMapped = new Map();
        for (const row of ourProducts || []) {
          for (const [key, id] of Object.entries(row.supplier_variants || {})) {
            alreadyMapped.set(key, id);
          }
        }
        return res.status(200).json({
          printful: printfulProducts.map((p) => ({
            id: p.id, name: p.name, variantCount: p.variants.length,
          })),
          suggestions,
          mappedCount: alreadyMapped.size,
          mapped: Object.fromEntries(alreadyMapped),
        });
      } catch (err) {
        console.error('Store variant read error:', err);
        return res.status(502).json({
          error: `Could not read your Printful store: ${err.message}`,
        });
      }
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      // Accepts { confirmed: [{ productId, key, syncVariantId }] } — the rows a
      // human has ticked. Grouped per product because that is how it is stored.
      const confirmed = Array.isArray(body.confirmed) ? body.confirmed : null;
      if (!confirmed) return res.status(400).json({ error: 'Send { confirmed: [...] }.' });

      const byProduct = new Map();
      const unplaced = [];
      for (const row of confirmed) {
        const productId = String(row.productId || '').trim();
        const colour = String(row.colour || '').trim();
        const size = String(row.size || '*').trim() || '*';
        const id = String(row.syncVariantId || '').trim();
        if (!productId) return res.status(400).json({ error: 'Every row needs a productId.' });
        // A row without a colour cannot be turned into an order key. Collecting
        // these and refusing the whole save is deliberate: a half-saved map
        // looks finished in the admin and fails at the first real order.
        if (!colour) { unplaced.push(row.variantName || id); continue; }
        const key = `${productId}|${colour}|${size}`;
        if (!/^[A-Za-z0-9-]+\|(\*|[A-Za-z0-9 .&-]+)\|(\*|[A-Za-z0-9 .&-]+)$/.test(key)) {
          return res.status(400).json({ error: `"${key}" is not a valid variant key (expected product|colour|size).` });
        }
        if (!key.startsWith(`${productId}|`)) {
          return res.status(400).json({ error: `Key "${key}" does not belong to "${productId}".` });
        }
        if (!/^[0-9]{1,20}$/.test(id)) {
          return res.status(400).json({ error: `The Printful id for "${key}" must be numeric.` });
        }
        if (!byProduct.has(productId)) byProduct.set(productId, {});
        byProduct.get(productId)[key] = id;
      }

      if (unplaced.length) {
        return res.status(400).json({
          error: `These Printful variants have no Armonia colour assigned yet: ${unplaced.slice(0, 6).join(', ')}${unplaced.length > 6 ? '…' : ''}. Pick a colour for each, then save.`,
        });
      }

      const saved = [];
      try {
        for (const [productId, variants] of byProduct) {
          const updated = await updateProduct(productId, { supplier: 'printful', supplier_variants: variants });
          if (!updated) {
            return res.status(404).json({
              error: `"${productId}" is not in the products table. Run supabase/schema-v15.sql, then reload.`,
            });
          }
          saved.push({ productId, variants: Object.keys(variants).length });
        }
        clearCatalogCache();
        return res.status(200).json({ ok: true, saved });
      } catch (err) {
        console.error('Store variant save error:', err);
        return res.status(500).json({ error: 'Could not save those variant mappings.' });
      }
    }
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // ── /api/admin/store-mockups ──
  // Per-colour garment photographs, generated rather than borrowed.
  //
  // GET  — which colours Printful already has a mockup for, and which do not.
  // POST — generate the missing ones (bounded), then report what landed.
  //
  // This exists because a colour without its own photo is worse than a colour
  // with no photo: showing one colour's garment under another colour's name is
  // a mis-sale. The alternative was asking the owner to hand-upload dozens of
  // images, which is what went wrong last time.
  if (route === 'store-mockups') {
    if (req.method === 'GET') {
      try {
        const { have, missing } = await listVariantMockups();
        const rows = await listProducts().catch(() => []);

        // Merge into what the storefront is actually serving, so the panel shows
        // the real state of the shop rather than Printful's state.
        const perProduct = (rows || []).map((row) => {
          const images = row.images || {};
          const colours = Array.isArray(row.colors) ? row.colors : [];
          return {
            id: row.id,
            name: row.name,
            colours: colours.map((colour) => ({
              name: colour,
              photo: images[colour] || have[row.id]?.[colour] || null,
              source: images[colour] ? 'site' : have[row.id]?.[colour] ? 'printful' : null,
            })),
            // Colours the shopper can pick that would show no photograph.
            blankColours: colours.filter((colour) => !images[colour] && !have[row.id]?.[colour]),
          };
        });

        return res.status(200).json({
          ok: true,
          products: perProduct,
          // Everything Printful has no mockup for anywhere in the account.
          missingFromPrintful: missing.slice(0, 40),
          totalMissing: missing.length,
        });
      } catch (err) {
        console.error('Store mockup read error:', err);
        return res.status(502).json({ error: `Could not read your Printful store: ${err.message}` });
      }
    }

    if (req.method === 'POST') {
      // Bounded on purpose. Generating a mockup per colour per product is dozens
      // of calls, and a burst would trip Printful's rate limit and leave the
      // store half-updated. The caller sends one product at a time.
      const body = req.body || {};
      const productId = String(body.productId || '').trim();
      if (!productId) return res.status(400).json({ error: 'Send { productId }.' });

      try {
        const [printfulProducts, rows] = await Promise.all([
          listSyncProducts(),
          listProducts().catch(() => []),
        ]);
        const row = (rows || []).find((r) => r.id === productId);
        if (!row) return res.status(404).json({ error: `"${productId}" is not one of your products.` });

        const pf = printfulProducts.find((p) => p.externalId === productId)
          // Fall back to the same loose name match the sync uses, so a product
          // whose external_id was never set can still be rendered.
          || printfulProducts.find((p) => {
            const a = String(p.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const b = String(row.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return a && b && (a.includes(b) || b.includes(a));
          });
        if (!pf) return res.status(404).json({ error: `Printful has no product matching "${row.name}".` });

        // One render per colour that does not already have a site photo.
        const wanted = (pf.variants || []).filter((v) => {
          const colour = String(v.colour || '').trim();
          if (!colour) return false;
          if ((row.images || {})[colour]) return false;   // already has a photo
          if (v.preview) return false;                    // Printful already rendered it
          return true;
        });

        if (!wanted.length) {
          return res.status(200).json({
            ok: true,
            generated: 0,
            message: 'Every colour already has a photograph, or Printful has already rendered one.',
          });
        }

        // Printful renders per catalog variant; a colour has several sizes but
        // one garment, so render the first variant of each colour.
        const seenColours = new Set();
        const picks = [];
        for (const v of wanted) {
          const colour = String(v.colour || '').trim();
          if (seenColours.has(colour) || !v.variantId) continue;
          seenColours.add(colour);
          picks.push(v);
        }

        const generated = {};
        const failures = [];
        for (const v of picks) {
          const colour = String(v.colour || '').trim();
          const printFile = v.artwork ? [{ type: 'default', url: v.artwork }] : [];
          if (!printFile.length) {
            failures.push({ colour, error: 'Printful has no print file on this variant.' });
            continue;
          }
          try {
            // One task per variant: the endpoint takes one variant set, and a
            // failure on one colour must not discard the others.
            const { mockups } = await createMockupTask([v.variantId], printFile, { productId: pf.id });
            const url = mockups[String(v.variantId)] || Object.values(mockups)[0];
            if (url) generated[colour] = url;
            else failures.push({ colour, error: 'Printful returned no image for this variant.' });
          } catch (err) {
            failures.push({ colour, error: err.message });
          }
        }

        if (Object.keys(generated).length) {
          await updateProduct(productId, { images: { ...(row.images || {}), ...generated } });
          clearCatalogCache();
        }

        return res.status(200).json({
          ok: failures.length === 0,
          generated: Object.keys(generated).length,
          images: generated,
          failures,
          message: Object.keys(generated).length
            ? `Generated ${Object.keys(generated).length} mockup(s) for "${row.name}".`
            : `No mockups were generated for "${row.name}".`,
        });
      } catch (err) {
        console.error('Store mockup generate error:', err);
        return res.status(502).json({ error: `Could not generate mockups: ${err.message}` });
      }
    }
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // ── /api/admin/store-fulfilment ──
  // The supplier integration's control panel: is it configured, and can a
  // stuck order be pushed through by hand. The automatic path runs from the
  // Stripe webhook; this exists for the case where the supplier was down at the
  // moment the money arrived.
  if (route === 'store-fulfilment') {
    if (req.method === 'GET') {
      const status = supplierStatus();
      // Ping both. A supplier that is unconfigured is not an error — it is
      // simply not part of fulfilment yet — so its health is reported without
      // making the whole panel look broken.
      const [printfulResult, printkkResult] = await Promise.all([
        status.suppliers.printful ? printfulHealth() : Promise.resolve({ configured: false }),
        status.suppliers.printkk ? printkkHealth() : Promise.resolve({ configured: false }),
      ]);
      // A setup checklist, computed rather than written down, so it can never
      // drift from what the code actually needs. Each item says what is
      // missing and what to do about it.
      const products = (await listProducts().catch(() => null)) || [];
      const unmapped = products
        .filter((row) => row.in_stock !== false && !Object.keys(row.supplier_variants || {}).length)
        .map((row) => row.id);
      const checklist = [
        {
          key: 'printful',
          done: status.suppliers.printful,
          label: 'Printful credentials',
          hint: 'Set PRINTFUL_API_TOKEN in Vercel, then redeploy.',
        },
        {
          key: 'printkk',
          done: status.suppliers.printkk,
          label: 'PrintKK credentials',
          hint: 'Set PRINTKK_API_KEY and PRINTKK_SECRET_KEY in Vercel, then redeploy.',
        },
        {
          key: 'webhook',
          done: status.webhookReady,
          label: 'Printful webhook token',
          hint: 'Set PRINTFUL_WEBHOOK_TOKEN, then press Register webhook with Printful below. Printful has no dashboard screen for this.',
        },
        {
          key: 'cron',
          done: status.cronReady,
          label: 'Cron secret',
          hint: 'Set CRON_SECRET so the daily PrintKK tracking poll can authenticate.',
        },
        {
          key: 'variants',
          done: products.length > 0 && unmapped.length === 0,
          label: 'Every product has a supplier variant',
          hint: unmapped.length
            ? `Still to map: ${unmapped.join(', ')}. Do it under Products & Prices → Supplier variants.`
            : 'Map each product under Products & Prices → Supplier variants.',
        },
      ];
      return res.status(200).json({
        ...status,
        health: { printful: printfulResult, printkk: printkkResult },
        checklist,
        ready: checklist.every((item) => item.done),
      });
    }

    if (req.method === 'POST') {
      const { orderNumber } = req.body || {};
      if (!orderNumber) return res.status(400).json({ error: 'An order number is required.' });
      if (!supplierStatus().configured) {
        return res.status(400).json({
          error: 'No supplier is configured yet. Set PRINTFUL_API_TOKEN and/or PRINTKK_API_KEY + PRINTKK_SECRET_KEY.',
        });
      }
      try {
        const order = await findOrderByNumber(String(orderNumber).trim());
        if (!order) return res.status(404).json({ error: 'That order number is not in the order book.' });
        const result = await submitToSupplier(order);
        if (!result.ok) return res.status(400).json({ error: result.reason || result.error || 'Could not submit that order.' });
        return res.status(200).json({ ok: true, supplierOrderId: result.id, status: result.status, skipped: Boolean(result.skipped) });
      } catch (err) {
        console.error('Supplier submit error:', err);
        return res.status(500).json({ error: 'Could not submit that order.' });
      }
    }
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // ── /api/admin/store-decorations ──
  // The seasonal switch. Separate from store-settings because it is not a
  // number and it is the one control somebody will reach for on a phone, in
  // December, wanting it off now.
  if (route === 'store-decorations') {
    if (req.method === 'GET') {
      try {
        const decorations = await getDecorationSettings();
        return res.status(200).json({ decorations });
      } catch (err) {
        console.error('Decoration read error:', err);
        return res.status(500).json({ error: 'Could not read the decoration setting.' });
      }
    }
    if (req.method === 'PATCH') {
      const body = req.body || {};
      try {
        const decorations = await setDecorationSettings({
          on: body.on,
          decoration: body.decoration,
          text: body.text,
        });
        // The storefront reads this through /api/store/catalog, which caches
        // the assembled catalogue for 15s. Clearing it here means the switch
        // takes effect on the next request rather than on the next coffee.
        clearCatalogCache();
        return res.status(200).json({ ok: true, decorations });
      } catch (err) {
        console.error('Decoration save error:', err);
        return res.status(400).json({ error: err.message || 'Could not save that setting.' });
      }
    }
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // ── /api/admin/store-settings ──
  // Shipping is editable too: the fee and the free-shipping threshold are the
  // two numbers customers notice most, and they are not prices of any product.
  if (route === 'store-settings') {
    if (req.method === 'GET') {
      const settings = await getSettings();
      return res.status(200).json({ settings: settings || { shipping_fee_cents: 600, free_shipping_cents: 7500 } });
    }
    if (req.method === 'PATCH') {
      const body = req.body || {};
      const patch = {};
      if (body.shippingFeeCents !== undefined) {
        const cents = Number(body.shippingFeeCents);
        if (!Number.isInteger(cents) || cents < 0 || cents > 100000) {
          return res.status(400).json({ error: 'Shipping fee must be between 0 and 100,000 cents.' });
        }
        patch.shipping_fee_cents = cents;
      }
      if (body.freeShippingCents !== undefined) {
        const cents = Number(body.freeShippingCents);
        if (!Number.isInteger(cents) || cents < 0 || cents > 100000) {
          return res.status(400).json({ error: 'Free-shipping threshold must be between 0 and 100,000 cents.' });
        }
        patch.free_shipping_cents = cents;
      }
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update.' });
      try {
        const settings = await updateSettings(patch);
        clearCatalogCache();
        return res.status(200).json({ ok: true, settings });
      } catch (err) {
        console.error('Store settings update error:', err);
        return res.status(500).json({ error: 'Could not save those settings.' });
      }
    }
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // ── /api/admin/announcements ──
  if (route === 'announcements') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { title, body, imageUrl } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: 'Title and body are required.' });
    const { error } = await supabase.from('announcements').insert({ title, body, image_url: imageUrl || null });
    if (error) { console.error('Announcement post error:', error); return res.status(500).json({ error: 'Could not post announcement.' }); }
    return res.status(200).json({ ok: true });
  }

  // ── /api/admin/revoke ──
  if (route === 'revoke') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { code, revoked } = req.body || {};
    if (!code || typeof revoked !== 'boolean') return res.status(400).json({ error: 'code and revoked (true/false) are required.' });
    const { error } = await supabase.from('access_codes').update({ revoked }).eq('code', code.trim().toUpperCase());
    if (error) { console.error('Revoke error:', error); return res.status(500).json({ error: 'Could not update that code.' }); }
    return res.status(200).json({ ok: true });
  }

  // ── /api/admin/reset-device ──
  if (route === 'reset-device') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const code = (req.body?.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'code is required.' });
    const { error } = await supabase.from('access_codes').update({ bound_device_id: null, bound_ip_hash: null, bound_at: null }).eq('code', code);
    if (error) { console.error('Reset device error:', error); return res.status(500).json({ error: "Could not reset this code's device binding." }); }
    return res.status(200).json({ ok: true });
  }

  // ── /api/admin/device-requests ──
  if (route === 'device-requests') {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('device_change_requests').select('id, code, attempted_device_id, ip_hash, user_agent, status, created_at, resolved_at').order('created_at', { ascending: false }).limit(100);
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not load device requests.' }); }
      return res.status(200).json({ requests: data });
    }
    if (req.method === 'POST') {
      const { id, action } = req.body || {};
      if (!id || !['approve', 'deny'].includes(action)) return res.status(400).json({ error: 'id and a valid action are required.' });
      const { data: reqRow, error: findErr } = await supabase.from('device_change_requests').select('*').eq('id', id).maybeSingle();
      if (findErr || !reqRow) return res.status(404).json({ error: 'Request not found.' });
      if (reqRow.status !== 'pending') return res.status(400).json({ error: 'This request was already resolved.' });
      if (action === 'approve') {
        const { error: updateErr } = await supabase.from('access_codes').update({ bound_device_id: reqRow.attempted_device_id, bound_ip_hash: reqRow.ip_hash, bound_at: new Date().toISOString() }).eq('code', reqRow.code);
        if (updateErr) { console.error(updateErr); return res.status(500).json({ error: 'Could not approve — please try again.' }); }
      }
      const { error: resolveErr } = await supabase.from('device_change_requests').update({ status: action === 'approve' ? 'approved' : 'denied', resolved_at: new Date().toISOString() }).eq('id', id);
      if (resolveErr) { console.error(resolveErr); return res.status(500).json({ error: 'Could not update request status.' }); }
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── /api/admin/upload-maestro-photo ──
  if (route === 'upload-maestro-photo') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { imageBase64, contentType } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'No image provided.' });
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(contentType)) return res.status(400).json({ error: 'Please upload a JPG, PNG, or WEBP image.' });
    try {
      const buffer = Buffer.from(imageBase64.split(',').pop(), 'base64');
      if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image is too large — please use one under 5MB.' });
      const ext = contentType.split('/')[1];
      const path = `maestro/photo-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('profile-photos').upload(path, buffer, { contentType, upsert: true });
      if (uploadError) throw uploadError;
      const { data: publicUrlData } = supabase.storage.from('profile-photos').getPublicUrl(path);
      await supabase.from('site_content').upsert({ key: 'maestro.photo_url', value: publicUrlData.publicUrl, updated_at: new Date().toISOString() });
      return res.status(200).json({ url: publicUrlData.publicUrl });
    } catch (err) {
      console.error('Maestro photo upload error:', err);
      return res.status(500).json({ error: 'Could not upload the photo. Please try again.' });
    }
  }

  // ── /api/admin/upload-image ──
  // Generic image upload used for lesson covers, instrument portal covers,
  // and announcement images — all go to the shared "site-images" bucket.
  if (route === 'upload-image') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { imageBase64, contentType } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'No image provided.' });
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(contentType)) return res.status(400).json({ error: 'Please upload a JPG, PNG, GIF, or WEBP image.' });
    try {
      const buffer = Buffer.from(imageBase64.split(',').pop(), 'base64');
      if (buffer.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'Image is too large — please use one under 6MB.' });
      const ext = contentType.split('/')[1];
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('site-images').upload(path, buffer, { contentType, upsert: true });
      if (uploadError) throw uploadError;
      const { data: publicUrlData } = supabase.storage.from('site-images').getPublicUrl(path);
      return res.status(200).json({ url: publicUrlData.publicUrl });
    } catch (err) {
      console.error('Site image upload error:', err);
      return res.status(500).json({ error: 'Could not upload that image. Please try again.' });
    }
  }

  // ── /api/admin/community-posts (moderation view) ──
  if (route === 'community-posts') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const { data: posts, error } = await supabase
      .from('community_posts')
      .select('id, author_code, body, image_url, created_at')
      .order('created_at', { ascending: false })
      .limit(150);
    if (error) { console.error(error); return res.status(500).json({ error: 'Could not load posts.' }); }

    const codes = [...new Set(posts.map(p => p.author_code))];
    const { data: profiles } = codes.length
      ? await supabase.from('student_profiles').select('code, name').in('code', codes)
      : { data: [] };
    const nameByCode = {};
    (profiles || []).forEach(p => { nameByCode[p.code] = p.name; });

    const shaped = posts.map(p => ({
      id: p.id, body: p.body, imageUrl: p.image_url, createdAt: p.created_at,
      authorName: nameByCode[p.author_code] || 'Armonía Student',
    }));
    return res.status(200).json({ posts: shaped });
  }

  // ── /api/admin/community-post (delete one, for moderation) ──
  if (route === 'community-post') {
    if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id query param required.' });
    // community_replies and community_likes cascade-delete automatically (foreign key ON DELETE CASCADE).
    const { error } = await supabase.from('community_posts').delete().eq('id', id);
    if (error) { console.error(error); return res.status(500).json({ error: 'Could not delete that post.' }); }
    return res.status(200).json({ ok: true });
  }

  // ── /api/admin/mock-auditions ──
  if (route === 'mock-auditions') {
    if (req.method === 'GET') {
      const { data: auditions, error } = await supabase.from('mock_auditions').select('*').order('event_date', { ascending: true });
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not load mock auditions.' }); }
      const { data: signups } = await supabase.from('mock_audition_signups').select('mock_audition_id, code');
      const countByAudition = {};
      (signups || []).forEach(s => { countByAudition[s.mock_audition_id] = (countByAudition[s.mock_audition_id] || 0) + 1; });
      const shaped = auditions.map(a => ({
        id: a.id, title: a.title, description: a.description, eventDate: a.event_date,
        zoomLink: a.zoom_link, signupCount: countByAudition[a.id] || 0,
      }));
      return res.status(200).json({ auditions: shaped });
    }
    if (req.method === 'POST') {
      const { title, description, eventDate, zoomLink } = req.body || {};
      if (!title || !eventDate) return res.status(400).json({ error: 'Title and event date are required.' });
      const { data, error } = await supabase.from('mock_auditions').insert({ title, description: description || null, event_date: eventDate, zoom_link: zoomLink || null }).select().single();
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not create the mock audition.' }); }
      return res.status(200).json({ audition: data });
    }
    if (req.method === 'PATCH') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id query param required.' });
      const { title, description, eventDate, zoomLink } = req.body || {};
      const update = {};
      if (title !== undefined) update.title = title;
      if (description !== undefined) update.description = description;
      if (eventDate !== undefined) update.event_date = eventDate;
      if (zoomLink !== undefined) update.zoom_link = zoomLink;
      const { data, error } = await supabase.from('mock_auditions').update(update).eq('id', id).select().single();
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not update that.' }); }
      return res.status(200).json({ audition: data });
    }
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id query param required.' });
      const { error } = await supabase.from('mock_auditions').delete().eq('id', id);
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not delete that.' }); }
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── /api/admin/generate-code ──
  // Admin-generated access codes — same access_codes table and same email
  // delivery real purchases use, just without going through Stripe.
  if (route === 'generate-code') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { email, codeType } = req.body || {};
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid email is required.' });
    const type = codeType === 'classroom' ? 'classroom' : 'student';
    const quantity = Math.min(50, Math.max(1, parseInt(req.body?.quantity, 10) || 1));

    const codes = [];
    for (let i = 0; i < quantity; i++) {
      let code = generateAccessCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: existing } = await supabase.from('access_codes').select('code').eq('code', code).maybeSingle();
        if (!existing) break;
        code = generateAccessCode();
      }
      codes.push(code);
    }

    const { error } = await supabase.from('access_codes').insert(
      codes.map(code => ({ code, email, code_type: type, source: 'admin', revoked: false }))
    );
    if (error) { console.error('Admin code generation error:', error); return res.status(500).json({ error: 'Could not generate codes. Please try again.' }); }

    try {
      if (codes.length === 1) await sendGeneratedCodeEmail({ to: email, code: codes[0], codeType: type });
      else await sendGeneratedCodeBatchEmail({ to: email, codes, codeType: type });
    } catch (err) {
      console.error('Generated-code email send error:', err);
      return res.status(200).json({ codes, email, codeType: type, emailSent: false });
    }
    return res.status(200).json({ codes, email, codeType: type, emailSent: true });
  }

  // ── /api/admin/batch-message ── (message every student studying a given instrument) ──
  if (route === 'batch-message') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { instrument, body } = req.body || {};
    if (!instrument || !body || !body.trim()) return res.status(400).json({ error: 'Instrument and message body are required.' });

    const { data: profiles, error: profileErr } = await supabase.from('student_profiles').select('code').eq('instrument', instrument);
    if (profileErr) { console.error('Batch message profile lookup error:', profileErr); return res.status(500).json({ error: 'Could not look up students.' }); }
    if (!profiles || !profiles.length) return res.status(200).json({ sent: 0 });

    const { data: activeCodes } = await supabase.from('access_codes').select('code').in('code', profiles.map(p => p.code)).eq('revoked', false);
    const codes = (activeCodes || []).map(c => c.code);
    if (!codes.length) return res.status(200).json({ sent: 0 });

    const { error } = await supabase.from('messages').insert(codes.map(code => ({ code, sender: 'maestro', body: body.trim() })));
    if (error) { console.error('Batch message insert error:', error); return res.status(500).json({ error: 'Could not send the message.' }); }

    return res.status(200).json({ sent: codes.length });
  }

  // ── /api/admin/course-updates ── (review, edit, publish, or discard drafts) ──
  if (route === 'course-updates') {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('course_updates').select('*').order('created_at', { ascending: false }).limit(100);
      if (error) { console.error('Admin course-updates fetch error:', error); return res.status(500).json({ error: 'Could not load updates.' }); }
      return res.status(200).json({ updates: data });
    }
    if (req.method === 'POST') {
      // Manual update, written directly by admin (not auto-generated from a lesson).
      const { title, body, publishNow } = req.body || {};
      if (!title) return res.status(400).json({ error: 'Title is required.' });
      const insert = { title, body: body || null, source: 'manual', status: publishNow ? 'published' : 'pending' };
      if (publishNow) insert.published_at = new Date().toISOString();
      const { data, error } = await supabase.from('course_updates').insert(insert).select().single();
      if (error) { console.error('Admin course-update create error:', error); return res.status(500).json({ error: 'Could not create update.' }); }
      return res.status(200).json({ update: data });
    }
    if (req.method === 'PATCH') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id query param required.' });
      const { title, body, publish } = req.body || {};
      const update = {};
      if (title !== undefined) update.title = title;
      if (body !== undefined) update.body = body;
      if (publish) { update.status = 'published'; update.published_at = new Date().toISOString(); }
      const { error } = await supabase.from('course_updates').update(update).eq('id', id);
      if (error) { console.error('Admin course-update patch error:', error); return res.status(500).json({ error: 'Could not save changes.' }); }
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id query param required.' });
      const { error } = await supabase.from('course_updates').delete().eq('id', id);
      if (error) { console.error('Admin course-update delete error:', error); return res.status(500).json({ error: 'Could not discard this update.' }); }
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(404).json({ error: 'Not found.' });
}
