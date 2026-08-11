// POST /api/admin/reset-device  { code }
// Clears a code's device binding so it can bind to a new device on next
// login. Use this when a student legitimately gets a new phone/laptop,
// or after confirming a support request isn't someone trying to reuse a
// friend's code.

import { requireAdmin } from '../../lib/requireAdmin.js';
import { supabase } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = requireAdmin(req);
  if (admin.error) return res.status(admin.status).json({ error: admin.error });

  const code = (req.body?.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'code is required.' });

  const { error } = await supabase
    .from('access_codes')
    .update({ bound_device_id: null, bound_ip_hash: null, bound_at: null })
    .eq('code', code);

  if (error) {
    console.error('Reset device error:', error);
    return res.status(500).json({ error: 'Could not reset this code\'s device binding.' });
  }

  return res.status(200).json({ ok: true });
}
