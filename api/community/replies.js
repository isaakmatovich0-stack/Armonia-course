// GET  /api/community/replies?postId=xxx -> replies for one post, oldest first
// POST /api/community/replies             -> { postId, body } add a reply

import { requireSession } from '../../lib/requireSession.js';
import { supabase } from '../../lib/supabase.js';
import { loadAuthorDisplayMap } from '../../lib/communityDisplay.js';

export default async function handler(req, res) {
  const session = await requireSession(req);
  if (session.error) {
    return res.status(session.status).json({ error: session.error, kicked: !!session.kicked });
  }

  if (req.method === 'GET') {
    const postId = req.query.postId;
    if (!postId) return res.status(400).json({ error: 'postId query param required.' });

    const { data, error } = await supabase
      .from('community_replies')
      .select('id, author_code, body, created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) { console.error(error); return res.status(500).json({ error: 'Could not load replies.' }); }

    const authorMap = await loadAuthorDisplayMap(data.map(r => r.author_code));
    const shaped = data.map(r => ({
      id: r.id,
      body: r.body,
      createdAt: r.created_at,
      isMine: r.author_code === session.code,
      author: authorMap[r.author_code],
    }));

    return res.status(200).json({ replies: shaped });
  }

  if (req.method === 'POST') {
    const postId = req.body?.postId;
    const body = (req.body?.body || '').trim();
    if (!postId || !body) return res.status(400).json({ error: 'postId and body are required.' });
    if (body.length > 1000) return res.status(400).json({ error: 'That reply is too long.' });

    const { data, error } = await supabase.from('community_replies').insert({
      post_id: postId,
      author_code: session.code,
      body,
    }).select().single();
    if (error) { console.error(error); return res.status(500).json({ error: 'Could not post your reply.' }); }

    return res.status(200).json({ reply: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
