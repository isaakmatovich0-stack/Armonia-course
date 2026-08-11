// GET  /api/community/posts -> the feed, newest first, with per-post like
//      count, whether the current student has liked it, reply count, and
//      author display info (never the author's raw access code).
// POST /api/community/posts -> create a new post, optionally with an image

import { requireSession } from '../../lib/requireSession.js';
import { supabase } from '../../lib/supabase.js';
import { loadAuthorDisplayMap } from '../../lib/communityDisplay.js';

export default async function handler(req, res) {
  const session = await requireSession(req);
  if (session.error) {
    return res.status(session.status).json({ error: session.error, kicked: !!session.kicked });
  }

  if (req.method === 'GET') {
    const { data: posts, error } = await supabase
      .from('community_posts')
      .select('id, author_code, body, image_url, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) { console.error(error); return res.status(500).json({ error: 'Could not load the community feed.' }); }

    if (!posts.length) return res.status(200).json({ posts: [] });

    const postIds = posts.map(p => p.id);

    const [{ data: likes, error: likesErr }, { data: replies, error: repliesErr }] = await Promise.all([
      supabase.from('community_likes').select('post_id, author_code').in('post_id', postIds),
      supabase.from('community_replies').select('post_id').in('post_id', postIds),
    ]);
    if (likesErr) { console.error(likesErr); return res.status(500).json({ error: 'Could not load likes.' }); }
    if (repliesErr) { console.error(repliesErr); return res.status(500).json({ error: 'Could not load replies.' }); }

    const authorMap = await loadAuthorDisplayMap(posts.map(p => p.author_code));

    const likeCountByPost = {};
    const likedByMeByPost = {};
    likes.forEach(l => {
      likeCountByPost[l.post_id] = (likeCountByPost[l.post_id] || 0) + 1;
      if (l.author_code === session.code) likedByMeByPost[l.post_id] = true;
    });

    const replyCountByPost = {};
    replies.forEach(r => { replyCountByPost[r.post_id] = (replyCountByPost[r.post_id] || 0) + 1; });

    const shaped = posts.map(p => ({
      id: p.id,
      body: p.body,
      imageUrl: p.image_url,
      createdAt: p.created_at,
      isMine: p.author_code === session.code,
      author: authorMap[p.author_code],
      likeCount: likeCountByPost[p.id] || 0,
      likedByMe: !!likedByMeByPost[p.id],
      replyCount: replyCountByPost[p.id] || 0,
    }));

    return res.status(200).json({ posts: shaped });
  }

  if (req.method === 'POST') {
    const body = (req.body?.body || '').trim();
    const imageUrl = req.body?.imageUrl || null;
    if (!body && !imageUrl) return res.status(400).json({ error: 'Write something or attach an image.' });
    if (body.length > 2000) return res.status(400).json({ error: 'That post is too long.' });

    const { data, error } = await supabase.from('community_posts').insert({
      author_code: session.code,
      body,
      image_url: imageUrl,
    }).select().single();
    if (error) { console.error(error); return res.status(500).json({ error: 'Could not post that. Please try again.' }); }

    return res.status(200).json({ post: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
