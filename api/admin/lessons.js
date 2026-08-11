// GET    /api/admin/lessons            -> list all lessons
// POST   /api/admin/lessons            -> create a lesson
// PATCH  /api/admin/lessons?id=xxx     -> update a lesson
// DELETE /api/admin/lessons?id=xxx     -> delete a lesson
//
// This is what powers the "Lessons" tab in /admin/ — add a Soundslice ID
// or video URL here and it's live on the course site instantly, no code
// changes needed.

import { requireAdmin } from '../../lib/requireAdmin.js';
import { supabase } from '../../lib/supabase.js';

const VALID_INSTRUMENTS = ['vihuela', 'guitarra', 'guitarra-de-golpe', 'guitarron'];
const VALID_SECTIONS = ['etude', 'practice_technique', 'performance', 'etude_fifths'];

export default async function handler(req, res) {
  const admin = requireAdmin(req);
  if (admin.error) return res.status(admin.status).json({ error: admin.error });

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('lessons')
      .select('*')
      .order('instrument_key', { ascending: true })
      .order('section', { ascending: true })
      .order('sort_order', { ascending: true });

    if (error) { console.error(error); return res.status(500).json({ error: 'Could not load lessons.' }); }
    return res.status(200).json({ lessons: data });
  }

  if (req.method === 'POST') {
    const { instrumentKey, section, title, description, videoUrl, soundsliceId, sortOrder } = req.body || {};
    if (!VALID_INSTRUMENTS.includes(instrumentKey)) return res.status(400).json({ error: 'Invalid instrument.' });
    if (!VALID_SECTIONS.includes(section)) return res.status(400).json({ error: 'Invalid section.' });
    if (!title) return res.status(400).json({ error: 'Title is required.' });

    const { data, error } = await supabase.from('lessons').insert({
      instrument_key: instrumentKey,
      section,
      title,
      description: description || null,
      video_url: videoUrl || null,
      soundslice_id: soundsliceId || null,
      sort_order: sortOrder || 0,
    }).select().single();

    if (error) { console.error(error); return res.status(500).json({ error: 'Could not create lesson.' }); }
    return res.status(200).json({ lesson: data });
  }

  if (req.method === 'PATCH') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id query param required.' });
    const { title, description, videoUrl, soundsliceId, sortOrder, section, instrumentKey } = req.body || {};

    const update = { updated_at: new Date().toISOString() };
    if (title !== undefined) update.title = title;
    if (description !== undefined) update.description = description;
    if (videoUrl !== undefined) update.video_url = videoUrl;
    if (soundsliceId !== undefined) update.soundslice_id = soundsliceId;
    if (sortOrder !== undefined) update.sort_order = sortOrder;
    if (section !== undefined) update.section = section;
    if (instrumentKey !== undefined) update.instrument_key = instrumentKey;

    const { data, error } = await supabase.from('lessons').update(update).eq('id', id).select().single();
    if (error) { console.error(error); return res.status(500).json({ error: 'Could not update lesson.' }); }
    return res.status(200).json({ lesson: data });
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id query param required.' });
    const { error } = await supabase.from('lessons').delete().eq('id', id);
    if (error) { console.error(error); return res.status(500).json({ error: 'Could not delete lesson.' }); }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
