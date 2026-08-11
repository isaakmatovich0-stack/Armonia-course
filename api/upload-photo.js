// POST /api/upload-photo
// Accepts a base64-encoded image from the profile form, uploads it to
// Supabase Storage (bucket: "profile-photos"), and returns the public URL
// to save on the student's profile.
//
// Requires a public Storage bucket named "profile-photos" to exist in
// Supabase (see README — one click to create, no code needed).

import { requireSession } from '../lib/requireSession.js';
import { supabase } from '../lib/supabase.js';

export const config = {
  api: { bodyParser: { sizeLimit: '6mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireSession(req);
  if (session.error) {
    return res.status(session.status).json({ error: session.error, kicked: !!session.kicked });
  }

  const { imageBase64, contentType } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: 'No image provided.' });
  }

  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(contentType)) {
    return res.status(400).json({ error: 'Please upload a JPG, PNG, or WEBP image.' });
  }

  try {
    const buffer = Buffer.from(imageBase64.split(',').pop(), 'base64');
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image is too large — please use one under 5MB.' });
    }

    const ext = contentType.split('/')[1];
    const path = `${session.code}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('profile-photos')
      .upload(path, buffer, { contentType, upsert: true });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
      .from('profile-photos')
      .getPublicUrl(path);

    return res.status(200).json({ url: publicUrlData.publicUrl });
  } catch (err) {
    console.error('Photo upload error:', err);
    return res.status(500).json({ error: 'Could not upload your photo. Please try again.' });
  }
}
