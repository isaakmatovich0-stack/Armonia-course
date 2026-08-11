import jwt from 'jsonwebtoken';

export function requireAdmin(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return { error: 'Not signed in.', status: 401 };

  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
    if (!payload.admin) return { error: 'Not authorized.', status: 403 };
    return { ok: true };
  } catch (err) {
    return { error: 'Session expired. Please log in again.', status: 401 };
  }
}
