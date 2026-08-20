// Consolidated student-facing API.
//
// This single file replaces what used to be 7 separate files (profile,
// library, announcements, messages, session-check, upload-photo,
// site-content). Vercel's free (Hobby) plan caps a project at 12
// serverless functions total, and every file in /api counts as one — so
// as the feature set grew, related endpoints got bundled together here
// instead. The URLs your frontend already calls (/api/profile,
// /api/library, etc.) are unchanged — Vercel's [...slug] catch-all
// pattern routes them all into this one function internally, based on
// the first path segment after /api/.

import { requireSession } from '../lib/requireSession.js';
import { supabase } from '../lib/supabase.js';

export const config = {
  api: { bodyParser: { sizeLimit: '6mb' } }, // generous enough for upload-photo; harmless for smaller JSON routes
};

const INSTRUMENT_META = [
  { key: 'vihuela', name: 'Vihuela', teacher: 'Isaak Matovich' },
  { key: 'guitarra', name: 'Guitarra', teacher: 'Isaak Matovich' },
  { key: 'guitarra-de-golpe', name: 'Guitarra de Golpe', teacher: 'Isaak Matovich', hasFifths: true },
  { key: 'guitarron', name: 'Guitarrón', teacher: 'Isaak Matovich' },
];

function shapeLesson(row) {
  return { id: row.id, title: row.title, description: row.description, videoUrl: row.video_url, soundsliceId: row.soundslice_id, coverImageUrl: row.cover_image_url };
}

export default async function handler(req, res) {
  // Derive the route directly from the URL path (e.g. /api/profile -> "profile")
  // rather than relying solely on Vercel's dynamic-route query population,
  // which is more robust across deployment configurations.
  const urlParts = req.url.split('?')[0].split('/').filter(Boolean); // ['api', 'profile']
  const route = urlParts[1];

  // site-content is public (no login) — everything else below requires a session.
  if (route === 'site-content') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const { data, error } = await supabase.from('site_content').select('key, value');
    if (error) { console.error('Site content fetch error:', error); return res.status(500).json({ error: 'Could not load site content.' }); }
    const content = {};
    data.forEach(row => { content[row.key] = row.value; });
    return res.status(200).json({ content });
  }

  const session = await requireSession(req);
  if (session.error) {
    return res.status(session.status).json({ error: session.error, kicked: !!session.kicked });
  }

  // ── /api/profile ──
  if (route === 'profile') {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('student_profiles').select('*').eq('code', session.code).maybeSingle();
      if (error) { console.error('Profile fetch error:', error); return res.status(500).json({ error: 'Could not load your profile.' }); }
      return res.status(200).json({ profile: data || null, email: session.email, code: session.code, codeType: session.codeType || 'student' });
    }
    if (req.method === 'POST') {
      const isClassroom = session.codeType === 'classroom';
      if (isClassroom) {
        const { schoolName, teacherName } = req.body || {};
        if (!schoolName || !teacherName) {
          return res.status(400).json({ error: 'School name and teacher name are both required.' });
        }
        const { error } = await supabase.from('student_profiles').upsert({
          code: session.code, school_name: schoolName, teacher_name: teacherName,
          name: teacherName, updated_at: new Date().toISOString(),
        });
        if (error) { console.error('Classroom profile save error:', error); return res.status(500).json({ error: 'Could not save. Please try again.' }); }
        return res.status(200).json({ ok: true });
      }
      const { name, instrument, experienceLevel, yearsPlaying, bio, photoUrl } = req.body || {};
      if (!name || !instrument || !experienceLevel || !yearsPlaying) {
        return res.status(400).json({ error: 'Name, instrument, experience level, and years playing are required.' });
      }
      const { error } = await supabase.from('student_profiles').upsert({
        code: session.code, name, instrument, experience_level: experienceLevel,
        years_playing: yearsPlaying, bio: bio || null, photo_url: photoUrl || null,
        updated_at: new Date().toISOString(),
      });
      if (error) { console.error('Profile save error:', error); return res.status(500).json({ error: 'Could not save your profile. Please try again.' }); }
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── /api/library ──
  if (route === 'library') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const { data: lessonRows, error: lessonsError } = await supabase.from('lessons').select('*').order('sort_order', { ascending: true });
    if (lessonsError) { console.error('Library lessons fetch error:', lessonsError); return res.status(500).json({ error: 'Could not load the library.' }); }
    const { data: resourceRows, error: resourcesError } = await supabase.from('resources').select('*').order('sort_order', { ascending: true });
    if (resourcesError) { console.error('Library resources fetch error:', resourcesError); return res.status(500).json({ error: 'Could not load resources.' }); }

    const instruments = INSTRUMENT_META.map(meta => {
      const rowsFor = (section) => lessonRows.filter(r => r.instrument_key === meta.key && r.section === section).map(shapeLesson);
      const practiceTechniqueRows = rowsFor('practice_technique');
      const inst = {
        key: meta.key, name: meta.name, teacher: meta.teacher,
        etudes: rowsFor('etude'),
        practiceTechnique: practiceTechniqueRows[0] || { title: `${meta.name} — Practice Techniques`, description: null, videoUrl: null, soundsliceId: null },
        performanceTracks: rowsFor('performance'),
      };
      if (meta.hasFifths) inst.etudesInFifths = rowsFor('etude_fifths');
      return inst;
    });
    const resources = {
      chordBooks: resourceRows.filter(r => r.kind === 'chord_book').map(r => ({ id: r.id, title: r.title, fileUrl: r.file_url })),
      midiTracks: resourceRows.filter(r => r.kind === 'midi_track').map(r => ({ id: r.id, title: r.title, fileUrl: r.file_url })),
      sheetMusic: resourceRows.filter(r => r.kind === 'sheet_music').map(r => ({ id: r.id, title: r.title, fileUrl: r.file_url })),
    };
    return res.status(200).json({ instruments, resources });
  }

  // ── /api/announcements ──
  if (route === 'announcements') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const { data, error } = await supabase.from('announcements').select('id, title, body, image_url, created_at').order('created_at', { ascending: false }).limit(50);
    if (error) { console.error('Announcements fetch error:', error); return res.status(500).json({ error: 'Could not load announcements.' }); }
    return res.status(200).json({ announcements: data });
  }

  // ── /api/messages ──
  if (route === 'messages') {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('messages').select('id, sender, body, created_at').eq('code', session.code).order('created_at', { ascending: true }).limit(200);
      if (error) { console.error('Messages fetch error:', error); return res.status(500).json({ error: 'Could not load messages.' }); }
      await supabase.from('messages').update({ read_by_student: true }).eq('code', session.code).eq('sender', 'maestro').eq('read_by_student', false);
      return res.status(200).json({ messages: data });
    }
    if (req.method === 'POST') {
      const body = (req.body?.body || '').trim();
      if (!body) return res.status(400).json({ error: 'Message is empty.' });
      if (body.length > 2000) return res.status(400).json({ error: 'Message is too long.' });
      const { error } = await supabase.from('messages').insert({ code: session.code, sender: 'student', body });
      if (error) { console.error('Message send error:', error); return res.status(500).json({ error: 'Could not send your message. Please try again.' }); }
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── /api/session-check ──
  if (route === 'session-check') {
    const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('code', session.code).eq('sender', 'maestro').eq('read_by_student', false);
    return res.status(200).json({ ok: true, email: session.email, unreadCount: count || 0 });
  }

  // ── /api/upload-photo ──
  if (route === 'upload-photo') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { imageBase64, contentType } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'No image provided.' });
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(contentType)) return res.status(400).json({ error: 'Please upload a JPG, PNG, or WEBP image.' });
    try {
      const buffer = Buffer.from(imageBase64.split(',').pop(), 'base64');
      if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image is too large — please use one under 5MB.' });
      const ext = contentType.split('/')[1];
      const path = `${session.code}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('profile-photos').upload(path, buffer, { contentType, upsert: true });
      if (uploadError) throw uploadError;
      const { data: publicUrlData } = supabase.storage.from('profile-photos').getPublicUrl(path);
      return res.status(200).json({ url: publicUrlData.publicUrl });
    } catch (err) {
      console.error('Photo upload error:', err);
      return res.status(500).json({ error: 'Could not upload your photo. Please try again.' });
    }
  }

  // ── /api/mock-auditions ──
  if (route === 'mock-auditions') {
    if (req.method === 'GET') {
      const { data: auditions, error } = await supabase.from('mock_auditions').select('*').order('event_date', { ascending: true });
      if (error) { console.error(error); return res.status(500).json({ error: 'Could not load mock auditions.' }); }
      const { data: mySignups, error: signupErr } = await supabase.from('mock_audition_signups').select('mock_audition_id').eq('code', session.code);
      if (signupErr) { console.error(signupErr); return res.status(500).json({ error: 'Could not load your sign-ups.' }); }
      const signedUpIds = new Set((mySignups || []).map(s => s.mock_audition_id));
      const shaped = auditions.map(a => ({
        id: a.id, title: a.title, description: a.description, eventDate: a.event_date,
        isSignedUp: signedUpIds.has(a.id),
        // Only reveal the Zoom link to students who've actually agreed to attend.
        zoomLink: signedUpIds.has(a.id) ? a.zoom_link : null,
      }));
      return res.status(200).json({ auditions: shaped });
    }
    if (req.method === 'POST') {
      const mockAuditionId = req.body?.mockAuditionId;
      if (!mockAuditionId) return res.status(400).json({ error: 'mockAuditionId is required.' });
      const { error } = await supabase.from('mock_audition_signups').insert({ mock_audition_id: mockAuditionId, code: session.code });
      if (error && error.code !== '23505') { console.error(error); return res.status(500).json({ error: 'Could not sign you up. Please try again.' }); }
      const { data: audition } = await supabase.from('mock_auditions').select('zoom_link').eq('id', mockAuditionId).maybeSingle();
      return res.status(200).json({ ok: true, zoomLink: audition?.zoom_link || null });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(404).json({ error: 'Not found.' });
}
