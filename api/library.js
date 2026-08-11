// GET /api/library
// Returns the full course library, now sourced from the `lessons` and
// `resources` tables (managed at /admin/) instead of a hardcoded file.
// Instrument names/keys/teacher stay defined here since they rarely
// change; the actual lesson content is fully editable from the admin CMS.

import { requireSession } from '../lib/requireSession.js';
import { supabase } from '../lib/supabase.js';

const INSTRUMENT_META = [
  { key: 'vihuela', name: 'Vihuela', teacher: 'Isaak Matovich' },
  { key: 'guitarra', name: 'Guitarra', teacher: 'Isaak Matovich' },
  { key: 'guitarra-de-golpe', name: 'Guitarra de Golpe', teacher: 'Isaak Matovich', hasFifths: true },
  { key: 'guitarron', name: 'Guitarrón', teacher: 'Isaak Matovich' },
];

function shapeLesson(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    videoUrl: row.video_url,
    soundsliceId: row.soundslice_id,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireSession(req);
  if (session.error) {
    return res.status(session.status).json({ error: session.error, kicked: !!session.kicked });
  }

  const { data: lessonRows, error: lessonsError } = await supabase
    .from('lessons')
    .select('*')
    .order('sort_order', { ascending: true });

  if (lessonsError) {
    console.error('Library lessons fetch error:', lessonsError);
    return res.status(500).json({ error: 'Could not load the library.' });
  }

  const { data: resourceRows, error: resourcesError } = await supabase
    .from('resources')
    .select('*')
    .order('sort_order', { ascending: true });

  if (resourcesError) {
    console.error('Library resources fetch error:', resourcesError);
    return res.status(500).json({ error: 'Could not load resources.' });
  }

  const instruments = INSTRUMENT_META.map(meta => {
    const rowsFor = (section) => lessonRows.filter(r => r.instrument_key === meta.key && r.section === section).map(shapeLesson);

    const practiceTechniqueRows = rowsFor('practice_technique');
    const inst = {
      key: meta.key,
      name: meta.name,
      teacher: meta.teacher,
      etudes: rowsFor('etude'),
      practiceTechnique: practiceTechniqueRows[0] || { title: `${meta.name} — Practice Techniques`, description: null, videoUrl: null, soundsliceId: null },
      performanceTracks: rowsFor('performance'),
    };
    if (meta.hasFifths) inst.etudesInFifths = rowsFor('etude_fifths');
    return inst;
  });

  const resources = {
    chordBooks: resourceRows.filter(r => r.kind === 'chord_book').map(r => ({ id: r.id, title: r.title, fileUrl: r.file_url })),
    midiTracks: resourceRows.filter(r => r.kind === 'midi_track').map(r => ({ id: r.id, title: r.title, fileUrl: r.file_url })),
  };

  return res.status(200).json({ instruments, resources });
}
