// POST /api/admin/revoke -> flips a code's `revoked` flag, instantly cutting off access
// (their current session, if any, gets logged out on its next check-in)

import { requireAdmin } from '../../lib/requireAdmin.js';
import { supabase } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = requireAdmin(req);
  if (admin.error) return res.status(admin.status).json({ error: admin.error });

  const { code, revoked } = req.body || {};
  if (!code || typeof revoked !== 'boolean') {
    return res.status(400).json({ error: 'code and revoked (true/false) are required.' });
  }

  const { error } = await supabase
    .from('access_codes')
    .update({ revoked })
    .eq('code', code.trim().toUpperCase());

  if (error) {
    console.error('Revoke error:', error);
    return res.status(500).json({ error: 'Could not update that code.' });
  }

  return res.status(200).json({ ok: true });
}
