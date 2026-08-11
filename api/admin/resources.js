// GET    /api/admin/resources
// POST   /api/admin/resources
// PATCH  /api/admin/resources?id=xxx
// DELETE /api/admin/resources?id=xxx

import { requireAdmin } from '../../lib/requireAdmin.js';
import { supabase } from '../../lib/supabase.js';

export default async function handler(req, res) {
  const admin = requireAdmin(req);
  if (admin.error) return res.status(admin.status).json({ error: admin.error });

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('resources').select('*').order('kind').order('sort_order');
    if (error) { console.error(error); return res.status(500).json({ error: 'Could not load resources.' }); }
    return res.status(200).json({ resources: data });
  }

  if (req.method === 'POST') {
    const { kind, title, fileUrl, sortOrder } = req.body || {};
    if (!['chord_book', 'midi_track'].includes(kind)) return res.status(400).json({ error: 'Invalid kind.' });
    if (!title) return res.status(400).json({ error: 'Title is required.' });

    const { data, error } = await supabase.from('resources').insert({
      kind, title, file_url: fileUrl || null, sort_order: sortOrder || 0,
    }).select().single();
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
