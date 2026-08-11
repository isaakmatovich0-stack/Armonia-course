// Consolidated Community API — replaces 4 separate files (posts, like,
// replies, upload-image) with one function, same reason as api/[...slug].js:
// staying under Vercel's Hobby plan function limit. URLs your frontend
// already calls (/api/community/posts, /api/community/like, etc.) are
// unchanged — this file catches all of them via the [...slug] pattern.

import { requireSession } from '../../lib/requireSession.js';
import { supabase } from '../../lib/supabase.js';
import { loadAuthorDisplayMap } from '../../lib/communityDisplay.js';

export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } },
};

export default async function handler(req, res) {
  const session = await requireSession(req);
  if (session.error) {
    return res.status(session.status).json({ error: session.error, kicked: !!session.kicked });
  }

  // Derive the route from the URL path (e.g. /api/community/posts -> "posts")
  // rather than relying solely on Vercel's dynamic-route query population.
  const urlParts = req.url.split('?')[0].split('/').filter(Boolean); // ['api', 'community', 'posts']
  const route = urlParts[2];

  // ── /api/community/posts ──
  if (route === 'posts') {
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
        id: p.id, body: p.body, imageUrl: p.image_url, createdAt: p.created_at,
        isMine: p.author_code === session.code, author: authorMap[p.author_code],
        likeCount: likeCountByPost[p.id] || 0, likedByMe: !!likedByMeByPost[p.id],
        replyCount: replyCountByPost[p.id] || 0,
      }));
      return res.status(200).json({ posts: shaped });
    }
    if (req.method === 'POST') {
      const body = (req.body?.body || '').trim();
      const imageUrl = req.body?.imageUrl || null;
      if (!body && !imageUrl) return res.status(400).json({ error: 'Write something or attach an image.' });
      if (body.length > 2000) return res.status(400).json({ error: 'That post is too long.' });
      const { data, error } = await supabase.from('community_posts').insert({ author_code: session.code, body, image_url: imageUrl }).select().single();
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not post that. Please try again.' }); }
      return res.status(200).json({ post: data });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── /api/community/like ──
  if (route === 'like') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const postId = req.body?.postId;
    if (!postId) return res.status(400).json({ error: 'postId is required.' });

    const { data: existing, error: findErr } = await supabase.from('community_likes').select('id').eq('post_id', postId).eq('author_code', session.code).maybeSingle();
    if (findErr) { console.error(findErr); return res.status(500).json({ error: 'Could not update like.' }); }

    let liked;
    if (existing) {
      const { error } = await supabase.from('community_likes').delete().eq('id', existing.id);
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not unlike.' }); }
      liked = false;
    } else {
      const { error } = await supabase.from('community_likes').insert({ post_id: postId, author_code: session.code });
      if (error && error.code !== '23505') { console.error(error); return res.status(500).json({ error: 'Could not like.' }); }
      liked = true;
    }
    const { count, error: countErr } = await supabase.from('community_likes').select('id', { count: 'exact', head: true }).eq('post_id', postId);
    if (countErr) { console.error(countErr); return res.status(500).json({ error: 'Could not refresh like count.' }); }
    return res.status(200).json({ liked, likeCount: count || 0 });
  }

  // ── /api/community/replies ──
  if (route === 'replies') {
    if (req.method === 'GET') {
      const postId = req.query.postId;
      if (!postId) return res.status(400).json({ error: 'postId query param required.' });
      const { data, error } = await supabase.from('community_replies').select('id, author_code, body, created_at').eq('post_id', postId).order('created_at', { ascending: true });
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not load replies.' }); }
      const authorMap = await loadAuthorDisplayMap(data.map(r => r.author_code));
      const shaped = data.map(r => ({ id: r.id, body: r.body, createdAt: r.created_at, isMine: r.author_code === session.code, author: authorMap[r.author_code] }));
      return res.status(200).json({ replies: shaped });
    }
    if (req.method === 'POST') {
      const postId = req.body?.postId;
      const body = (req.body?.body || '').trim();
      if (!postId || !body) return res.status(400).json({ error: 'postId and body are required.' });
      if (body.length > 1000) return res.status(400).json({ error: 'That reply is too long.' });
      const { data, error } = await supabase.from('community_replies').insert({ post_id: postId, author_code: session.code, body }).select().single();
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not post your reply.' }); }
      return res.status(200).json({ reply: data });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── /api/community/upload-image ──
  if (route === 'upload-image') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { imageBase64, contentType } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'No image provided.' });
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(contentType)) return res.status(400).json({ error: 'Please upload a JPG, PNG, GIF, or WEBP image.' });
    try {
      const buffer = Buffer.from(imageBase64.split(',').pop(), 'base64');
      if (buffer.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'Image is too large — please use one under 6MB.' });
      const ext = contentType.split('/')[1];
      const path = `${session.code}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('community-images').upload(path, buffer, { contentType, upsert: true });
      if (uploadError) throw uploadError;
      const { data: publicUrlData } = supabase.storage.from('community-images').getPublicUrl(path);
      return res.status(200).json({ url: publicUrlData.publicUrl });
    } catch (err) {
      console.error('Community image upload error:', err);
      return res.status(500).json({ error: 'Could not upload your image. Please try again.' });
    }
  }

  return res.status(404).json({ error: 'Not found.' });
}
