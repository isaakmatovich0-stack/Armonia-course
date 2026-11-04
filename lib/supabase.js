// Shared Supabase client, used by every /api function that touches the database.
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to be set in Vercel's
// Environment Variables (Project Settings → Environment Variables).
//
// IMPORTANT: the "service role" key bypasses row-level security and must
// NEVER be exposed to the browser. It's only ever used inside these
// server-side /api functions, never in public/*.html or client-side JS.

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  // Don't throw at import time: a missing key should not take down an entire
  // serverless function (the storefront, for example, can still browse and
  // price its catalog without a database). Anything that actually queries will
  // fail with a clear message instead.
  console.warn('[supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — database calls will fail.');
}

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-service-role-key', {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const supabaseConfigured = Boolean(url && key);
