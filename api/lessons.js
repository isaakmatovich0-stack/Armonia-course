// GET /api/lessons
// Called by the course dashboard on load. Verifies the student's session
// token (issued by /api/redeem) and, if valid, returns the lesson list
// with Soundslice embed IDs. This is what actually gates your content —
// without a valid token, no lesson data is returned.
//
// Add your real lessons to the LESSONS array below as you finish editing
// each video. "soundsliceId" is the numeric ID from your Soundslice embed
// code (Soundslice dashboard -> your slice -> Embed -> copy the ID in the
// iframe src, e.g. soundslice.com/slices/XXXXX/embed/ -> XXXXX is the id).

import jwt from 'jsonwebtoken';

const LESSONS = [
  {
    id: 1,
    title: 'Lesson 1 — Posture & Right-Hand Technique',
    description: 'Foundations before we touch repertoire.',
    videoUrl: null,        // paste your hosted lesson video URL here once edited
    soundsliceId: null,    // paste your Soundslice slice ID for the performance track here
  },
  {
    id: 2,
    title: 'Lesson 2 — Manico Patterns I',
    description: 'The rhythmic vocabulary every judge listens for.',
    videoUrl: null,
    soundsliceId: null,
  },
  // Add the rest of your lessons here as you finish editing them.
];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
    return res.status(200).json({ email: payload.email, lessons: LESSONS });
  } catch (err) {
    return res.status(401).json({ error: 'Your session expired. Please log in again with your access code.' });
  }
}
