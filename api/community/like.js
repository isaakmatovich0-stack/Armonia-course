// POST /api/community/like  { postId }
// Toggles the current student's like on a post. If they haven't liked it,
// this likes it. If they have, this unlikes it. The `unique (post_id,
// author_code)` constraint in the database is the real enforcement — this
// endpoint just checks first so it can tell the client which way it went.

import { requireSession } from '../../lib/requireSession.js';
import { supabase } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireSession(req);
  if (session.error) {
    return res.status(session.status).json({ error: session.error, kicked: !!session.kicked });
  }

  const postId = req.body?.postId;
  if (!postId) return res.status(400).json({ error: 'postId is required.' });

  const { data: existing, error: findErr } = await supabase
    .from('community_likes')
    .select('id')
    .eq('post_id', postId)
    .eq('author_code', session.code)
    .maybeSingle();
  if (findErr) { console.error(findErr); return res.status(500).json({ error: 'Could not update like.' }); }

  let liked;
  if (existing) {
    const { error } = await supabase.from('community_likes').delete().eq('id', existing.id);
    if (error) { console.error(error); return res.status(500).json({ error: 'Could not unlike.' }); }
    liked = false;
  } else {
    // Insert; if a race causes a duplicate, the unique constraint rejects it —
    // treat that as "already liked" rather than an error.
    const { error } = await supabase.from('community_likes').insert({ post_id: postId, author_code: session.code });
    if (error && error.code !== '23505') { console.error(error); return res.status(500).json({ error: 'Could not like.' }); }
    liked = true;
  }

  const { count, error: countErr } = await supabase
    .from('community_likes')
    .select('id', { count: 'exact', head: true })
    .eq('post_id', postId);
  if (countErr) { console.error(countErr); return res.status(500).json({ error: 'Could not refresh like count.' }); }

  return res.status(200).json({ liked, likeCount: count || 0 });
}
