// GET /api/site-content
// Public — no login required, since this powers text on both the public
// flyer page and the gated course site. Returns every key/value pair as
// a flat object: { "announcements.title": "Announcements", ... }
//
// Pages fetch this once on load and use it to override their default
// hardcoded text, so the site still works even before any edits are made.

import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { data, error } = await supabase.from('site_content').select('key, value');
  if (error) {
    console.error('Site content fetch error:', error);
    return res.status(500).json({ error: 'Could not load site content.' });
  }

  const content = {};
  data.forEach(row => { content[row.key] = row.value; });
  return res.status(200).json({ content });
}
