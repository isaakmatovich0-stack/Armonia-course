// GET /api/admin/overview
// Powers your admin dashboard's student list: everyone who's enrolled,
// their profile info (if they've completed onboarding), and whether they
// have unread messages waiting for you.

import { requireAdmin } from '../../lib/requireAdmin.js';
import { supabase } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = requireAdmin(req);
  if (admin.error) return res.status(admin.status).json({ error: admin.error });

  const { data: codes, error: codesError } = await supabase
    .from('access_codes')
    .select('code, email, created_at, redeemed_count, last_login_at, revoked, bound_device_id, bound_at')
    .order('created_at', { ascending: false });

  if (codesError) {
    console.error('Admin overview codes error:', codesError);
    return res.status(500).json({ error: 'Could not load students.' });
  }

  const { data: profiles } = await supabase.from('student_profiles').select('*');
  const { data: unread } = await supabase
    .from('messages')
    .select('code')
    .eq('sender', 'student')
    .eq('read_by_maestro', false);

  const unreadCounts = {};
  (unread || []).forEach((m) => {
    unreadCounts[m.code] = (unreadCounts[m.code] || 0) + 1;
  });

  const profileByCode = {};
  (profiles || []).forEach((p) => { profileByCode[p.code] = p; });

  const students = codes.map((c) => ({
    ...c,
    profile: profileByCode[c.code] || null,
    unreadCount: unreadCounts[c.code] || 0,
  }));

  return res.status(200).json({ students });
}
