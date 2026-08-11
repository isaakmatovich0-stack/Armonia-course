// POST /api/admin/upload-maestro-photo
// Same idea as the student photo upload, but for Isaak's own profile
// picture shown in the Community member list. Admin-only.

import { requireAdmin } from '../../lib/requireAdmin.js';
import { supabase } from '../../lib/supabase.js';

export const config = {
  api: { bodyParser: { sizeLimit: '6mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = requireAdmin(req);
  if (admin.error) return res.status(admin.status).json({ error: admin.error });

  const { imageBase64, contentType } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'No image provided.' });

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
    const path = `maestro/photo-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('profile-photos')
      .upload(path, buffer, { contentType, upsert: true });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from('profile-photos').getPublicUrl(path);

    // Save straight to site_content so it's immediately live.
    await supabase.from('site_content').upsert({
      key: 'maestro.photo_url',
      value: publicUrlData.publicUrl,
      updated_at: new Date().toISOString(),
    });

    return res.status(200).json({ url: publicUrlData.publicUrl });
  } catch (err) {
    console.error('Maestro photo upload error:', err);
    return res.status(500).json({ error: 'Could not upload the photo. Please try again.' });
  }
}
