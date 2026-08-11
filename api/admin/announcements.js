// POST /api/admin/announcements -> post a new announcement, visible to all students immediately

import { requireAdmin } from '../../lib/requireAdmin.js';
import { supabase } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = requireAdmin(req);
  if (admin.error) return res.status(admin.status).json({ error: admin.error });

  const { title, body } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'Title and body are required.' });

  const { error } = await supabase.from('announcements').insert({ title, body });
  if (error) {
    console.error('Announcement post error:', error);
    return res.status(500).json({ error: 'Could not post announcement.' });
  }

  return res.status(200).json({ ok: true });
}
