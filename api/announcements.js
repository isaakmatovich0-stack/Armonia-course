// GET /api/announcements
// Returns the announcements feed, newest first, to any logged-in student.

import { requireSession } from '../lib/requireSession.js';
import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireSession(req);
  if (session.error) {
    return res.status(session.status).json({ error: session.error, kicked: !!session.kicked });
  }

  const { data, error } = await supabase
    .from('announcements')
    .select('id, title, body, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Announcements fetch error:', error);
    return res.status(500).json({ error: 'Could not load announcements.' });
  }

  return res.status(200).json({ announcements: data });
}
