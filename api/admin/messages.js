// GET  /api/admin/messages?code=XXXX -> thread with one student
// POST /api/admin/messages             -> send a reply as the maestro
//
// Your admin chat view polls GET the same way students do — every few
// seconds while a thread is open.

import { requireAdmin } from '../../lib/requireAdmin.js';
import { supabase } from '../../lib/supabase.js';

export default async function handler(req, res) {
  const admin = requireAdmin(req);
  if (admin.error) return res.status(admin.status).json({ error: admin.error });

  if (req.method === 'GET') {
    const code = (req.query.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'code query param required.' });

    const { data, error } = await supabase
      .from('messages')
      .select('id, sender, body, created_at')
      .eq('code', code)
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) {
      console.error('Admin messages fetch error:', error);
      return res.status(500).json({ error: 'Could not load thread.' });
    }

    await supabase
      .from('messages')
      .update({ read_by_maestro: true })
      .eq('code', code)
      .eq('sender', 'student')
      .eq('read_by_maestro', false);

    return res.status(200).json({ messages: data });
  }

  if (req.method === 'POST') {
    const code = (req.body?.code || '').trim().toUpperCase();
    const body = (req.body?.body || '').trim();
    if (!code || !body) return res.status(400).json({ error: 'code and body are required.' });

    const { error } = await supabase.from('messages').insert({
      code,
      sender: 'maestro',
      body,
    });

    if (error) {
      console.error('Admin message send error:', error);
      return res.status(500).json({ error: 'Could not send reply.' });
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
