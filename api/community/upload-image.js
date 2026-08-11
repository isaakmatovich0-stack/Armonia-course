// POST /api/community/upload-image
// Accepts a base64 image from the community composer, uploads it to
// Supabase Storage (bucket: "community-images"), returns the public URL.
//
// Requires a public Storage bucket named "community-images" in Supabase
// (same one-click setup as "profile-photos" — see README).

import { requireSession } from '../../lib/requireSession.js';
import { supabase } from '../../lib/supabase.js';

export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } },
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
  if (!imageBase64) return res.status(400).json({ error: 'No image provided.' });

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(contentType)) {
    return res.status(400).json({ error: 'Please upload a JPG, PNG, GIF, or WEBP image.' });
  }

  try {
    const buffer = Buffer.from(imageBase64.split(',').pop(), 'base64');
    if (buffer.length > 6 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image is too large — please use one under 6MB.' });
    }

    const ext = contentType.split('/')[1];
    const path = `${session.code}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('community-images')
      .upload(path, buffer, { contentType, upsert: true });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from('community-images').getPublicUrl(path);
    return res.status(200).json({ url: publicUrlData.publicUrl });
  } catch (err) {
    console.error('Community image upload error:', err);
    return res.status(500).json({ error: 'Could not upload your image. Please try again.' });
  }
}
