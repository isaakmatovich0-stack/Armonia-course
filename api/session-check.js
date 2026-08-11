// GET /api/session-check
// The dashboard calls this every ~15 seconds in the background. If it
// comes back 401 with kicked: true, the client shows "logged in
// elsewhere" and redirects to the code screen. This is what makes the
// single-session lock actually visible to a logged-out student instead
// of just silently failing their next click.

import { requireSession } from '../lib/requireSession.js';

export default async function handler(req, res) {
  const session = await requireSession(req);
  if (session.error) {
    return res.status(session.status).json({ error: session.error, kicked: !!session.kicked });
  }
  return res.status(200).json({ ok: true, email: session.email });
}
