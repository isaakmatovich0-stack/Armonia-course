// GET  /api/messages -> this student's full conversation with the maestro
// POST /api/messages -> send a new message as the student
//
// The dashboard's chat widget polls GET every ~4 seconds while open, which
// is what makes this feel "live" without needing a websocket server.

import { requireSession } from '../lib/requireSession.js';
import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  const session = await requireSession(req);
  if (session.error) {
    return res.status(session.status).json({ error: session.error, kicked: !!session.kicked });
  }

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('messages')
      .select('id, sender, body, created_at')
      .eq('code', session.code)
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) {
      console.error('Messages fetch error:', error);
      return res.status(500).json({ error: 'Could not load messages.' });
    }

    // Mark maestro's messages as read now that the student has fetched them.
    await supabase
      .from('messages')
      .update({ read_by_student: true })
      .eq('code', session.code)
      .eq('sender', 'maestro')
      .eq('read_by_student', false);

    return res.status(200).json({ messages: data });
  }

  if (req.method === 'POST') {
    const body = (req.body?.body || '').trim();
    if (!body) {
      return res.status(400).json({ error: 'Message is empty.' });
    }
    if (body.length > 2000) {
      return res.status(400).json({ error: 'Message is too long.' });
    }

    const { error } = await supabase.from('messages').insert({
      code: session.code,
      sender: 'student',
      body,
    });

    if (error) {
      console.error('Message send error:', error);
      return res.status(500).json({ error: 'Could not send your message. Please try again.' });
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
