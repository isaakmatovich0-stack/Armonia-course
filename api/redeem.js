// POST /api/redeem
// Called by the course site's login screen when a student enters their code.
//
// Device binding, now with a review queue: the first time a code is used,
// it's tied to that browser. A different device trying the same code
// doesn't get auto-rejected forever — it creates a pending request that
// shows up in /admin/ under "Device Requests," where you personally
// decide whether to approve it (e.g. a real device change) or leave it
// blocked (e.g. someone trying to reuse a friend's code).

import { supabase } from '../lib/supabase.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

function hashIp(ip) {
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
  const deviceId = (req.body?.deviceId || '').trim();

  if (!raw) {
    return res.status(400).json({ error: 'Enter your access code.' });
  }
  if (!deviceId) {
    return res.status(400).json({ error: 'Could not verify this browser. Please refresh the page and try again.' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress;
  const ipHash = hashIp(ip);

  // ── Rate limiting ──
  // 4 failed attempts within 15 minutes from the same IP blocks further
  // tries. Checked before the code lookup so a locked-out IP can't keep
  // probing for valid codes at all, successful or not.
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count: recentFailures } = await supabase
    .from('failed_login_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gt('created_at', fifteenMinAgo);
  if ((recentFailures || 0) >= 4) {
    return res.status(429).json({ error: 'Too many failed attempts. Please wait 15 minutes and try again, or contact maestro.armoniaconnect@gmail.com if you need help finding your code.' });
  }

  const { data: record, error } = await supabase
    .from('access_codes')
    .select('code, email, revoked, redeemed_count, bound_device_id, code_type')
    .eq('code', raw)
    .maybeSingle();

  if (error) {
    console.error('Redeem lookup error:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }

  if (!record) {
    await supabase.from('failed_login_attempts').insert({ ip_hash: ipHash });
    return res.status(404).json({ error: 'That code was not recognized. Double-check it against your confirmation email.' });
  }

  if (record.revoked) {
    await supabase.from('failed_login_attempts').insert({ ip_hash: ipHash });
    return res.status(403).json({ error: 'This code is no longer active. Contact maestro.armoniaconnect@gmail.com for help.' });
  }

  const isClassroom = record.code_type === 'classroom';

  // ── Device binding check ──
  // Classroom codes are meant for a shared/big-screen setup and explicitly
  // support multiple simultaneous logins, so they skip device binding
  // entirely — no single "owning" device, no approval queue.
  if (!isClassroom && record.bound_device_id && record.bound_device_id !== deviceId) {
    // Don't spam duplicate pending rows if they keep retrying with the same device.
    const { data: existingPending } = await supabase
      .from('device_change_requests')
      .select('id')
      .eq('code', record.code)
      .eq('attempted_device_id', deviceId)
      .eq('status', 'pending')
      .maybeSingle();

    if (!existingPending) {
      await supabase.from('device_change_requests').insert({
        code: record.code,
        attempted_device_id: deviceId,
        ip_hash: ipHash,
        user_agent: req.headers['user-agent'] || '',
      });
    }

    return res.status(403).json({
      error: 'This code is already active on a different device. We\'ve sent this request to the instructor for review — you\'ll be able to log in once it\'s approved. If this is your own new device, you can also email maestro.armoniaconnect@gmail.com directly.',
      pendingApproval: true,
    });
  }

  const sessionToken = crypto.randomBytes(24).toString('hex');
  const isFirstBinding = !record.bound_device_id;

  await supabase.from('login_events').insert({
    code: record.code,
    ip_hash: ipHash,
    user_agent: req.headers['user-agent'] || '',
  });

  const update = {
    redeemed_at: record.redeemed_count === 0 ? new Date().toISOString() : undefined,
    last_login_at: new Date().toISOString(),
    redeemed_count: (record.redeemed_count || 0) + 1,
  };
  // Classroom codes never write a single "current" session token — that's
  // exactly the mechanism that kicks older sessions on a new login, and
  // classroom codes are supposed to allow many logins at once.
  if (!isClassroom) {
    update.current_session_token = sessionToken;
    update.session_started_at = new Date().toISOString();
    if (isFirstBinding) {
      update.bound_device_id = deviceId;
      update.bound_ip_hash = ipHash;
      update.bound_at = new Date().toISOString();
    }
  }

  await supabase.from('access_codes').update(update).eq('code', record.code);

  // Check whether this student has completed onboarding yet.
  const { data: profile } = await supabase
    .from('student_profiles')
    .select('code, name, school_name')
    .eq('code', record.code)
    .maybeSingle();

  const token = jwt.sign(
    { code: record.code, email: record.email, sessionToken, codeType: record.code_type },
    process.env.SESSION_SECRET,
    { expiresIn: '30d' }
  );

  const needsOnboarding = isClassroom ? !profile?.school_name : !profile;

  return res.status(200).json({
    token,
    email: record.email,
    needsOnboarding,
    codeType: record.code_type,
  });
}
