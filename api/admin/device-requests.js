// GET  /api/admin/device-requests       -> pending + recently resolved requests
// POST /api/admin/device-requests        { id, action: 'approve' | 'deny' }
//
// This is the review queue for the device-binding system: whenever a code
// is used on a device it isn't bound to, a row lands here instead of
// being silently rejected forever. You decide what happens next.

import { requireAdmin } from '../../lib/requireAdmin.js';
import { supabase } from '../../lib/supabase.js';

export default async function handler(req, res) {
  const admin = requireAdmin(req);
  if (admin.error) return res.status(admin.status).json({ error: admin.error });

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('device_change_requests')
      .select('id, code, attempted_device_id, ip_hash, user_agent, status, created_at, resolved_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) { console.error(error); return res.status(500).json({ error: 'Could not load device requests.' }); }
    return res.status(200).json({ requests: data });
  }

  if (req.method === 'POST') {
    const { id, action } = req.body || {};
    if (!id || !['approve', 'deny'].includes(action)) {
      return res.status(400).json({ error: 'id and a valid action are required.' });
    }

    const { data: reqRow, error: findErr } = await supabase
      .from('device_change_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (findErr || !reqRow) return res.status(404).json({ error: 'Request not found.' });
    if (reqRow.status !== 'pending') return res.status(400).json({ error: 'This request was already resolved.' });

    if (action === 'approve') {
      // Rebind the code to the new device — this is the actual unlock.
      const { error: updateErr } = await supabase
        .from('access_codes')
        .update({
          bound_device_id: reqRow.attempted_device_id,
          bound_ip_hash: reqRow.ip_hash,
          bound_at: new Date().toISOString(),
        })
        .eq('code', reqRow.code);
      if (updateErr) { console.error(updateErr); return res.status(500).json({ error: 'Could not approve — please try again.' }); }
    }

    const { error: resolveErr } = await supabase
      .from('device_change_requests')
      .update({ status: action === 'approve' ? 'approved' : 'denied', resolved_at: new Date().toISOString() })
      .eq('id', id);
    if (resolveErr) { console.error(resolveErr); return res.status(500).json({ error: 'Could not update request status.' }); }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
