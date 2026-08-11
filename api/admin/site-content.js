// GET   /api/admin/site-content        -> list all editable text keys/values
// PATCH /api/admin/site-content        -> upsert one { key, value } pair
//
// Powers the "Edit Text" toggle: when Isaak clicks a piece of text on the
// live site (while logged into the admin panel), it saves here.

import { requireAdmin } from '../../lib/requireAdmin.js';
import { supabase } from '../../lib/supabase.js';

export default async function handler(req, res) {
  const admin = requireAdmin(req);
  if (admin.error) return res.status(admin.status).json({ error: admin.error });

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('site_content').select('*').order('key');
    if (error) { console.error(error); return res.status(500).json({ error: 'Could not load site content.' }); }
    return res.status(200).json({ content: data });
  }

  if (req.method === 'PATCH') {
    const { key, value } = req.body || {};
    if (!key || value === undefined) return res.status(400).json({ error: 'key and value are required.' });

    const { error } = await supabase.from('site_content').upsert({
      key, value, updated_at: new Date().toISOString(),
    });
    if (error) { console.error(error); return res.status(500).json({ error: 'Could not save.' }); }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
