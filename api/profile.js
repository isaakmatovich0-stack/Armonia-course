// GET  /api/profile  -> returns the logged-in student's profile (or null fields if not set yet)
// POST /api/profile  -> saves/updates it (used by onboarding form and the "edit profile" page)

import { requireSession } from '../lib/requireSession.js';
import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  const session = await requireSession(req);
  if (session.error) {
    return res.status(session.status).json({ error: session.error, kicked: !!session.kicked });
  }

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('student_profiles')
      .select('*')
      .eq('code', session.code)
      .maybeSingle();

    if (error) {
      console.error('Profile fetch error:', error);
      return res.status(500).json({ error: 'Could not load your profile.' });
    }
    return res.status(200).json({ profile: data || null, email: session.email });
  }

  if (req.method === 'POST') {
    const { name, instrument, experienceLevel, yearsPlaying, bio, photoUrl } = req.body || {};

    if (!name || !instrument || !experienceLevel || !yearsPlaying) {
      return res.status(400).json({ error: 'Name, instrument, experience level, and years playing are required.' });
    }

    const { error } = await supabase.from('student_profiles').upsert({
      code: session.code,
      name,
      instrument,
      experience_level: experienceLevel,
      years_playing: yearsPlaying,
      bio: bio || null,
      photo_url: photoUrl || null,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      console.error('Profile save error:', error);
      return res.status(500).json({ error: 'Could not save your profile. Please try again.' });
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
