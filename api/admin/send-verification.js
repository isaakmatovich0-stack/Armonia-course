// POST /api/admin/send-verification
// Generates a verification link and emails it to the admin's current
// login_email. Click the link → /admin/verify.html → confirms it.

import { requireAdmin } from '../../lib/requireAdmin.js';
import { supabase } from '../../lib/supabase.js';
import { sendAdminVerificationEmail } from '../../lib/email.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = requireAdmin(req);
  if (admin.error) return res.status(admin.status).json({ error: admin.error });

  const { data: account, error } = await supabase.from('admin_account').select('*').maybeSingle();
  if (error || !account) { console.error(error); return res.status(500).json({ error: 'Could not load your account.' }); }

  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  const { error: updateErr } = await supabase
    .from('admin_account')
    .update({ verification_token: token, verification_token_expires: expires })
    .eq('id', account.id);
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
