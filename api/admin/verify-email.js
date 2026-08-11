// POST /api/admin/verify-email  { token }
// Public endpoint — this is what /admin/verify.html calls after reading
// the token out of the URL. Not admin-gated on purpose, since the person
// clicking it is doing so from their email, not from a logged-in session.

import { supabase } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  const { error: updateErr } = await supabase
    .from('admin_account')
    .update({ login_email_verified: true, verification_token: null, verification_token_expires: null })
    .eq('id', account.id);
  if (updateErr) { console.error(updateErr); return res.status(500).json({ error: 'Could not verify. Please try again.' }); }

  return res.status(200).json({ ok: true });
}
