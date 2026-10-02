// Batch-loads display info (name, photo, instrument) for a set of student
// codes, keyed by an opaque per-request index — never returns the raw
// access code itself in any response, since that's the login secret.
// Also resolves each student's public_id — a separate, safe-to-share
// identifier (used for direct messaging between students) that carries no
// login power, unlike the access code.

import { supabase } from './supabase.js';

export async function loadAuthorDisplayMap(codes) {
  const unique = [...new Set(codes)];
  if (unique.length === 0) return {};

  const { data, error } = await supabase
    .from('student_profiles')
    .select('code, name, photo_url, instrument, public_id')
    .in('code', unique);

  if (error) throw error;

  const map = {};
  data.forEach(row => {
    map[row.code] = { name: row.name || 'Armonía Student', photoUrl: row.photo_url || null, instrument: row.instrument || null, publicId: row.public_id };
  });
  // Fallback for any code without a completed profile yet.
  unique.forEach(code => {
    if (!map[code]) map[code] = { name: 'Armonía Student', photoUrl: null, instrument: null, publicId: null };
  });
  return map;
}
