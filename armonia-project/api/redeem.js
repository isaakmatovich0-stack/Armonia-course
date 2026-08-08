// POST /api/redeem
// Called by the course site's login screen when a student enters their code.
// Validates the code and returns a signed session token (a simple JWT) that
// the course site stores and sends with future requests to unlock lessons.
//
// Requires SESSION_SECRET in Vercel env vars (any long random string).

import { supabase } from '../lib/supabase.js';
import jwt from 'jsonwebtoken';

function hashIp(ip) {
  // Lightweight, non-reversible fingerprint for the login_events log —
  // never store raw IPs.
  let hash = 0;
  const str = ip || 'unknown';
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const raw = (req.body?.code || '').trim().toUpperCase();
  if (!raw) {
    return res.status(400).json({ error: 'Enter your access code.' });
  }

  const { data: record, error } = await supabase
    .from('access_codes')
    .select('code, email, revoked, redeemed_count')
    .eq('code', raw)
    .maybeSingle();

  if (error) {
    console.error('Redeem lookup error:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }

  if (!record) {
    return res.status(404).json({ error: 'That code was not recognized. Double-check it against your confirmation email.' });
  }

  if (record.revoked) {
    return res.status(403).json({ error: 'This code is no longer active. Contact maestro.armoniaconnect@gmail.com for help.' });
  }

  // Log the login and bump counters — lets you spot a code being shared widely.
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress;
  await supabase.from('login_events').insert({
    code: record.code,
    ip_hash: hashIp(ip),
    user_agent: req.headers['user-agent'] || '',
  });
  await supabase
    .from('access_codes')
    .update({
      redeemed_at: record.redeemed_count === 0 ? new Date().toISOString() : undefined,
      last_login_at: new Date().toISOString(),
      redeemed_count: (record.redeemed_count || 0) + 1,
    })
    .eq('code', record.code);

  const token = jwt.sign(
    { code: record.code, email: record.email },
    process.env.SESSION_SECRET,
    { expiresIn: '30d' }
  );

  return res.status(200).json({ token, email: record.email });
}
