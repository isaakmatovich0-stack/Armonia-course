// Handles all outbound email via Resend.
// Requires RESEND_API_KEY in Vercel env vars.
// FROM_EMAIL must be on a domain you've verified in Resend (see README).

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.FROM_EMAIL || 'Armonía <no-reply@armonia-mariachi.com>';
const COURSE_SITE_URL = process.env.COURSE_SITE_URL || 'https://course.armonia-mariachi.com';
const SUPPORT_EMAIL = 'maestro.armoniaconnect@gmail.com';

const brandStyles = `
  font-family: Georgia, 'Times New Roman', serif;
  background:#0E0D0B; color:#F2EBD9;
`;

function emailShell(bodyHtml) {
  return `
  <div style="${brandStyles} padding:40px 24px; max-width:560px; margin:0 auto;">
    <p style="letter-spacing:3px; text-transform:uppercase; font-size:12px; color:#C9A84C; margin:0 0 24px;">
      Armonía &middot; TMEA All-State Mariachi Course
    </p>
    ${bodyHtml}
    <hr style="border:none; border-top:1px solid rgba(201,168,76,0.25); margin:32px 0;">
    <p style="font-size:12px; color:#8A8275;">
      Questions? Reply to this email or reach us at ${SUPPORT_EMAIL}.
    </p>
  </div>`;
}

/**
 * Sent right after a successful Stripe payment.
 */
export async function sendOrderConfirmationEmail({ to, name, code, amount }) {
  const firstName = name ? name.split(' ')[0] : 'there';
  const html = emailShell(`
    <h1 style="font-size:24px; color:#F2EBD9; margin:0 0 16px;">Welcome, ${firstName}.</h1>
    <p style="font-size:15px; line-height:1.6;">
      Your enrollment in Armonía is confirmed. Payment of $${(amount / 100).toFixed(2)} received.
      Your access code is below — this is your key into the course site and Armonía Connect.
    </p>
    <div style="background:rgba(201,168,76,0.08); border:1px solid rgba(201,168,76,0.35); padding:20px; text-align:center; margin:24px 0;">
      <p style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#8A8275; margin:0 0 8px;">Your Access Code</p>
      <p style="font-size:22px; letter-spacing:2px; color:#E8C97A; margin:0; font-family:monospace;">${code}</p>
    </div>
    <a href="${COURSE_SITE_URL}" style="display:inline-block; background:#C9A84C; color:#0E0D0B; padding:14px 28px; text-decoration:none; font-weight:600; letter-spacing:1px;">
      Enter the Course
    </a>
    <p style="font-size:13px; line-height:1.6; color:#8A8275; margin-top:24px;">
      Keep this code private — it's tied to your purchase and grants lifetime access to
      every lesson, performance track, and Armonía Connect.
    </p>
  `);

  return resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: 'Your Armonía access code is here',
    html,
  });
}

/**
 * Sent to you (maestro.armoniaconnect@gmail.com) when someone fills out the
 * contact form on the flyer page.
 */
export async function sendContactNotification({ firstName, lastName, email, subject, message }) {
  const html = emailShell(`
    <h1 style="font-size:20px; color:#F2EBD9; margin:0 0 16px;">New message from the site</h1>
    <p style="font-size:14px; margin:4px 0;"><strong>From:</strong> ${firstName} ${lastName} (${email})</p>
    <p style="font-size:14px; margin:4px 0;"><strong>Subject:</strong> ${subject}</p>
    <p style="font-size:15px; line-height:1.6; margin-top:16px; white-space:pre-wrap;">${message}</p>
  `);

  return resend.emails.send({
    from: FROM_EMAIL,
    to: SUPPORT_EMAIL,
    reply_to: email,
    subject: `[Armonía Contact] ${subject} — ${firstName} ${lastName}`,
    html,
  });
}
