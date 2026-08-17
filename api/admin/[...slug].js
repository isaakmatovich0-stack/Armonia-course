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
import { sendAdminVerificationEmail, sendGeneratedCodeEmail } from '../../lib/email.js';
import { generateAccessCode } from '../../lib/generateCode.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export const config = {
  api: { bodyParser: { sizeLimit: '6mb' } },
};

const VALID_INSTRUMENTS = ['vihuela', 'guitarra', 'guitarra-de-golpe', 'guitarron'];
const VALID_SECTIONS = ['etude', 'practice_technique', 'performance', 'etude_fifths'];

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
    const profileByCode = {};
    (profiles || []).forEach((p) => { profileByCode[p.code] = p; });
    const students = codes.map((c) => ({ ...c, profile: profileByCode[c.code] || null, unreadCount: unreadCounts[c.code] || 0 }));
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
      if (!['chord_book', 'midi_track'].includes(kind)) return res.status(400).json({ error: 'Invalid kind.' });
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

    let code = generateAccessCode();
    // guard against the astronomically unlikely collision
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: existing } = await supabase.from('access_codes').select('code').eq('code', code).maybeSingle();
      if (!existing) break;
      code = generateAccessCode();
    }

    const { error } = await supabase.from('access_codes').insert({
      code, email, code_type: type, source: 'admin', revoked: false,
    });
    if (error) { console.error('Admin code generation error:', error); return res.status(500).json({ error: 'Could not generate a code. Please try again.' }); }

    try {
      await sendGeneratedCodeEmail({ to: email, code, codeType: type });
    } catch (err) {
      console.error('Generated-code email send error:', err);
      // Code was created successfully even if the email failed — surface both facts.
      return res.status(200).json({ code, email, codeType: type, emailSent: false });
    }
    return res.status(200).json({ code, email, codeType: type, emailSent: true });
  }

  return res.status(404).json({ error: 'Not found.' });
}
