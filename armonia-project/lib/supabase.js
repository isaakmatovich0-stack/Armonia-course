// Shared Supabase client, used by every /api function that touches the database.
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to be set in Vercel's
// Environment Variables (Project Settings → Environment Variables).
//
// IMPORTANT: the "service role" key bypasses row-level security and must
// NEVER be exposed to the browser. It's only ever used inside these
// server-side /api functions, never in public/*.html or client-side JS.

import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
