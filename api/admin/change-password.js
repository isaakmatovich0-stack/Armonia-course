// POST /api/admin/change-password  { currentPassword, newPassword }
// Verifies your current password, then actually changes it — from this
// point on, logging into /admin/ requires the new password. The env var
// ADMIN_PASSWORD is never consulted again after your account exists.

import { requireAdmin } from '../../lib/requireAdmin.js';
import { supabase } from '../../lib/supabase.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = requireAdmin(req);
  if (admin.error) return res.status(admin.status).json({ error: admin.error });

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are both required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  const { data: account, error } = await supabase.from('admin_account').select('*').maybeSingle();
  if (error || !account) { console.error(error); return res.status(500).json({ error: 'Could not load your account.' }); }

  if (!verifyPassword(currentPassword, account.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const { error: updateErr } = await supabase
    .from('admin_account')
    .update({ password_hash: hashPassword(newPassword), updated_at: new Date().toISOString() })
    .eq('id', account.id);
  if (updateErr) { console.error(updateErr); return res.status(500).json({ error: 'Could not update your password. Please try again.' }); }

  return res.status(200).json({ ok: true });
}
