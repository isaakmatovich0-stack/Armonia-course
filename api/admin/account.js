// GET   /api/admin/account -> your name, emails, verification status, account age
// PATCH /api/admin/account -> update name / login_email / billing_email
//
// Changing login_email resets verification — you'll need to re-verify
// the new address (Settings tab has a "Verify" button that sends the email).

import { requireAdmin } from '../../lib/requireAdmin.js';
import { supabase } from '../../lib/supabase.js';

export default async function handler(req, res) {
  const admin = requireAdmin(req);
  if (admin.error) return res.status(admin.status).json({ error: admin.error });

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('admin_account').select('*').maybeSingle();
    if (error) { console.error(error); return res.status(500).json({ error: 'Could not load your account.' }); }
    if (!data) return res.status(404).json({ error: 'No admin account found yet — log in once to create it.' });

    return res.status(200).json({
      id: data.id,
      name: data.name,
      loginEmail: data.login_email,
      loginEmailVerified: data.login_email_verified,
      billingEmail: data.billing_email,
      createdAt: data.created_at,
    });
  }

  if (req.method === 'PATCH') {
    const { name, loginEmail, billingEmail } = req.body || {};
    const update = { updated_at: new Date().toISOString() };

    if (name !== undefined) update.name = name;
    if (billingEmail !== undefined) update.billing_email = billingEmail;

    if (loginEmail !== undefined) {
      const { data: current } = await supabase.from('admin_account').select('login_email').maybeSingle();
      update.login_email = loginEmail;
      if (current && current.login_email !== loginEmail) {
        update.login_email_verified = false;
        update.verification_token = null;
        update.verification_token_expires = null;
      }
    }

    const { error } = await supabase.from('admin_account').update(update).not('id', 'is', null);
    if (error) { console.error(error); return res.status(500).json({ error: 'Could not save changes.' }); }

    // Also keep the public-facing "maestro.name" in sync automatically,
    // since that's what students see in Community — one name to manage.
    if (name !== undefined) {
      await supabase.from('site_content').upsert({ key: 'maestro.name', value: name, updated_at: new Date().toISOString() });
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
