// Shared by every gated endpoint (library, profile, messages, etc).
// Verifies the JWT AND that its embedded sessionToken still matches what's
// in the database — this second check is what makes "one active session
// per code" actually enforceable, since a code shared with a friend just
// silently logs out whichever session is older.

import jwt from 'jsonwebtoken';
import { supabase } from './supabase.js';

export async function requireSession(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    return { error: 'Not signed in.', status: 401 };
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.SESSION_SECRET);
  } catch (err) {
    return { error: 'Your session expired. Please log in again with your access code.', status: 401 };
  }

  const { data: record, error } = await supabase
    .from('access_codes')
    .select('code, email, revoked, current_session_token, code_type')
    .eq('code', payload.code)
    .maybeSingle();

  if (error || !record) {
    return { error: 'Session no longer valid. Please log in again.', status: 401 };
  }

  if (record.revoked) {
    return { error: 'This code is no longer active.', status: 403 };
  }

  // Classroom codes intentionally allow many simultaneous logins — they never
  // write a single "current" session token, so there's nothing to compare here.
  const isClassroom = record.code_type === 'classroom';
  if (!isClassroom && record.current_session_token !== payload.sessionToken) {
    return {
      error: 'Your access code was used to log in somewhere else, so this session has been signed out. If this wasn\'t you, your code may have been shared — contact maestro.armoniaconnect@gmail.com.',
      status: 401,
      kicked: true,
    };
  }

  return { code: record.code, email: record.email, codeType: record.code_type };
}
