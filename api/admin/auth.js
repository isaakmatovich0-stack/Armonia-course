// POST /api/admin/auth
// Logs into the real admin account (hashed password, stored in the
// admin_account table) rather than just comparing to the raw
// ADMIN_PASSWORD env var.
//
// First-ever login "bootstraps" the account: if no admin_account row
// exists yet, one is created using ADMIN_PASSWORD as the initial
// password (hashed immediately — the plaintext env var is only ever used
// once, right here, to set the first password). After that, the env var
// is no longer checked at all — change your password from Settings and
// it's the hash in the database that matters from then on.

import { supabase } from '../../lib/supabase.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body || {};
  if (!password) return res.status(401).json({ error: 'Incorrect password.' });

  const { data: existing, error } = await supabase.from('admin_account').select('*').maybeSingle();
  if (error) { console.error(error); return res.status(500).json({ error: 'Something went wrong. Please try again.' }); }

  let account = existing;

  if (!account) {
    // Bootstrap: first login ever. Create the account using the env var
    // password as the starting point.
    if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    const { data: created, error: createErr } = await supabase.from('admin_account').insert({
      name: 'Isaak Matovich',
      login_email: process.env.FROM_EMAIL?.match(/<(.+)>/)?.[1] || 'maestro.armoniaconnect@gmail.com',
      password_hash: hashPassword(password),
    }).select().single();
    if (createErr) { console.error(createErr); return res.status(500).json({ error: 'Could not set up your admin account. Please try again.' }); }
    account = created;
  } else {
    if (!verifyPassword(password, account.password_hash)) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }
  }

  const token = jwt.sign({ admin: true, adminId: account.id }, process.env.SESSION_SECRET, { expiresIn: '7d' });
  return res.status(200).json({ token });
}
