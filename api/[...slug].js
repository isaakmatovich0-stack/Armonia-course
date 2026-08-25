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
  { key: 'guitarra-de-golpe', name: 'Guitarra de Golpe', teacher: 'Isaak Matovich' },
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
      // Banner-only update — used by the "Change Banner" button, independent
      // of the full profile edit form, so a student can swap their banner
      // without needing to also resubmit name/instrument/etc.
      if (req.body?.bannerUrl !== undefined && req.body?.name === undefined && !isClassroom) {
        const { error } = await supabase.from('student_profiles').update({ banner_url: req.body.bannerUrl, updated_at: new Date().toISOString() }).eq('code', session.code);
        if (error) { console.error('Banner save error:', error); return res.status(500).json({ error: 'Could not save your banner. Please try again.' }); }
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

  // ── /api/conversations ──
  // The student's unified DM list: the pinned maestro thread, plus every
  // student-to-student conversation they're part of, sorted by recency.
  if (route === 'conversations') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { data: myProfile } = await supabase.from('student_profiles').select('public_id').eq('code', session.code).maybeSingle();
    const myPublicId = myProfile?.public_id || null;

    // Maestro thread (existing system, untouched).
    const { data: maestroMsgs } = await supabase.from('messages').select('sender, body, created_at, read_by_student').eq('code', session.code).order('created_at', { ascending: false }).limit(1);
    const { count: maestroUnread } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('code', session.code).eq('sender', 'maestro').eq('read_by_student', false);
    const maestroName = (await supabase.from('site_content').select('value').eq('key', 'maestro.name').maybeSingle()).data?.value || 'Isaak Matovich';
    const maestroPhoto = (await supabase.from('site_content').select('value').eq('key', 'maestro.photo_url').maybeSingle()).data?.value || null;

    const conversations = [{
      id: 'maestro',
      name: maestroName,
      photoUrl: maestroPhoto,
      lastMessage: maestroMsgs?.[0] ? { body: maestroMsgs[0].body, fromMe: maestroMsgs[0].sender === 'student', createdAt: maestroMsgs[0].created_at } : null,
      unreadCount: maestroUnread || 0,
      pinned: true,
    }];

    if (myPublicId) {
      const { data: dms } = await supabase
        .from('direct_messages')
        .select('sender_public_id, recipient_public_id, body, created_at, read')
        .or(`sender_public_id.eq.${myPublicId},recipient_public_id.eq.${myPublicId}`)
        .order('created_at', { ascending: false })
        .limit(300);

      const byPartner = {};
      (dms || []).forEach(m => {
        const partnerId = m.sender_public_id === myPublicId ? m.recipient_public_id : m.sender_public_id;
        if (!byPartner[partnerId]) byPartner[partnerId] = { lastMessage: m, unreadCount: 0 };
        if (m.recipient_public_id === myPublicId && !m.read) byPartner[partnerId].unreadCount++;
      });

      const partnerIds = Object.keys(byPartner);
      if (partnerIds.length) {
        const { data: partnerProfiles } = await supabase.from('student_profiles').select('public_id, name, photo_url').in('public_id', partnerIds);
        const profileByPublicId = {};
        (partnerProfiles || []).forEach(p => { profileByPublicId[p.public_id] = p; });

        partnerIds.forEach(pid => {
          const p = profileByPublicId[pid];
          const entry = byPartner[pid];
          conversations.push({
            id: pid,
            name: p?.name || 'Armonía Student',
            photoUrl: p?.photo_url || null,
            lastMessage: { body: entry.lastMessage.body, fromMe: entry.lastMessage.sender_public_id === myPublicId, createdAt: entry.lastMessage.created_at },
            unreadCount: entry.unreadCount,
            pinned: false,
          });
        });
      }
    }

    conversations.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
      const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
      return bTime - aTime;
    });

    return res.status(200).json({ conversations, myPublicId });
  }

  // ── /api/dm ── (student-to-student direct messages) ──
  if (route === 'dm') {
    const { data: myProfile } = await supabase.from('student_profiles').select('public_id').eq('code', session.code).maybeSingle();
    const myPublicId = myProfile?.public_id;
    if (!myPublicId) return res.status(400).json({ error: 'Complete your profile before messaging other students.' });

    if (req.method === 'GET') {
      const partnerId = (req.query.with || '').trim();
      if (!partnerId) return res.status(400).json({ error: 'with query param required.' });
      if (partnerId === myPublicId) return res.status(400).json({ error: "You can't message yourself." });

      const conversationId = [myPublicId, partnerId].sort().join('::');
      const { data, error } = await supabase.from('direct_messages').select('id, sender_public_id, body, created_at').eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(300);
      if (error) { console.error('DM fetch error:', error); return res.status(500).json({ error: 'Could not load this conversation.' }); }

      await supabase.from('direct_messages').update({ read: true }).eq('conversation_id', conversationId).eq('recipient_public_id', myPublicId).eq('read', false);

      const { data: partnerProfile } = await supabase.from('student_profiles').select('name, photo_url').eq('public_id', partnerId).maybeSingle();
      const messages = (data || []).map(m => ({ id: m.id, body: m.body, createdAt: m.created_at, fromMe: m.sender_public_id === myPublicId }));
      return res.status(200).json({ messages, partner: { name: partnerProfile?.name || 'Armonía Student', photoUrl: partnerProfile?.photo_url || null } });
    }

    if (req.method === 'POST') {
      const partnerId = (req.body?.to || '').trim();
      const body = (req.body?.body || '').trim();
      if (!partnerId || !body) return res.status(400).json({ error: 'Recipient and message body are required.' });
      if (partnerId === myPublicId) return res.status(400).json({ error: "You can't message yourself." });
      if (body.length > 2000) return res.status(400).json({ error: 'Message is too long.' });

      // Confirm the recipient is a real, active (non-revoked) student before allowing a new message.
      const { data: recipientProfile } = await supabase.from('student_profiles').select('code').eq('public_id', partnerId).maybeSingle();
      if (!recipientProfile) return res.status(404).json({ error: 'That student could not be found.' });
      const { data: recipientCodeRow } = await supabase.from('access_codes').select('revoked').eq('code', recipientProfile.code).maybeSingle();
      if (recipientCodeRow?.revoked) return res.status(403).json({ error: 'This student no longer has an active account.' });

      const conversationId = [myPublicId, partnerId].sort().join('::');
      const { error } = await supabase.from('direct_messages').insert({ conversation_id: conversationId, sender_public_id: myPublicId, recipient_public_id: partnerId, body });
      if (error) { console.error('DM send error:', error); return res.status(500).json({ error: 'Could not send your message. Please try again.' }); }
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── /api/session-check ──
  if (route === 'session-check') {
    const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('code', session.code).eq('sender', 'maestro').eq('read_by_student', false);
    const { data: profile } = await supabase.from('student_profiles').select('updates_last_seen_at').eq('code', session.code).maybeSingle();
    let unreadUpdates = 0;
    if (profile?.updates_last_seen_at) {
      const { count: uCount } = await supabase.from('course_updates').select('id', { count: 'exact', head: true }).eq('status', 'published').gt('published_at', profile.updates_last_seen_at);
      unreadUpdates = uCount || 0;
    } else {
      const { count: uCount } = await supabase.from('course_updates').select('id', { count: 'exact', head: true }).eq('status', 'published');
      unreadUpdates = uCount || 0;
    }
    return res.status(200).json({ ok: true, email: session.email, unreadCount: count || 0, unreadUpdateCount: unreadUpdates });
  }

  // ── /api/search ── (lessons + resources, for the topbar search bar) ──
  if (route === 'search') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.status(200).json({ results: [] });

    const [lessonsRes, resourcesRes] = await Promise.all([
      supabase.from('lessons').select('id, title, instrument_key, section').ilike('title', `%${q}%`).limit(8),
      supabase.from('resources').select('id, title, kind').ilike('title', `%${q}%`).limit(8),
    ]);

    const results = [
      ...(lessonsRes.data || []).map(l => ({ kind: 'Lesson', title: l.title, url: `/course/lesson.html?id=${l.id}` })),
      ...(resourcesRes.data || []).map(r => ({ kind: r.kind === 'sheet_music' ? 'Sheet Music' : (r.kind === 'chord_book' ? 'Chord Book' : 'MIDI'), title: r.title, url: `/course/dashboard.html#resources` })),
    ].slice(0, 10);

    return res.status(200).json({ results });
  }

  // ── /api/course-updates ── (published only, for the bell dropdown + updates page) ──
  if (route === 'course-updates') {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('course_updates').select('id, title, body, published_at').eq('status', 'published').order('published_at', { ascending: false }).limit(50);
      if (error) { console.error('Course updates fetch error:', error); return res.status(500).json({ error: 'Could not load updates.' }); }
      return res.status(200).json({ updates: data });
    }
    if (req.method === 'POST') {
      // Marks all current updates as "seen" for this student.
      await supabase.from('student_profiles').update({ updates_last_seen_at: new Date().toISOString() }).eq('code', session.code);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
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
