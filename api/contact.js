// POST /api/contact
// Called by the contact form at the bottom of the flyer page.
// Emails the message to maestro.armoniaconnect@gmail.com and logs it in Supabase.

import { supabase } from '../lib/supabase.js';
import { sendContactNotification } from '../lib/email.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { firstName, lastName, email, subject, message } = req.body || {};

  if (!firstName || !lastName || !email || !subject || !message) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    await supabase.from('contact_messages').insert({
      first_name: firstName,
      last_name: lastName,
      email,
      subject,
      message,
    });

    await sendContactNotification({ firstName, lastName, email, subject, message });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Contact form error:', err);
    return res.status(500).json({ error: 'Something went wrong sending your message. Please try emailing us directly.' });
  }
}
