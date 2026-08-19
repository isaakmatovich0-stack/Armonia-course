// Handles all outbound email via Resend.
// Requires RESEND_API_KEY in Vercel env vars.
// FROM_EMAIL must be on a domain you've verified in Resend (see README).

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.FROM_EMAIL || 'Armonía Connect <no-reply@armonia-mariachi.com>';
// The actual live login / code-entry page. Hardcoded and NOT read from an
// environment variable — this exact link was confirmed correct, and an
// env var was the repeated source of this pointing at the wrong page.
const LOGIN_URL = 'https://armonia-course.vercel.app/course/';
const SUPPORT_EMAIL = 'maestro.armoniaconnect@gmail.com';

const brandStyles = `
  font-family: Georgia, 'Times New Roman', serif;
  background:#0E0D0B; color:#F2EBD9;
`;

function emailShell(bodyHtml) {
  return `
  <div style="${brandStyles} padding:40px 24px; max-width:560px; margin:0 auto;">
    <p style="letter-spacing:3px; text-transform:uppercase; font-size:12px; color:#C9A84C; margin:0 0 24px;">
      Armonía Connect &middot; All-State Audition Etudes Course
    </p>
    ${bodyHtml}
    <p style="font-size:12px; color:#8A8275; margin-top:32px;">
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
      Your enrollment in Armonía Connect is confirmed. Payment of $${(amount / 100).toFixed(2)} received.
      Your access code is below — this is your key into the course site and the Armonía Connect Studio.
    </p>
    <p style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#8A8275; margin:24px 0 6px; text-align:center;">Your Access Code</p>
    <p style="font-size:24px; letter-spacing:2px; color:#E8C97A; margin:0 0 24px; font-family:monospace; text-align:center;">${code}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#C9A84C; border-radius:2px;">
      <a href="${LOGIN_URL}" style="display:inline-block; color:#0E0D0B; padding:14px 32px; text-decoration:none; font-weight:600; letter-spacing:1px;">Enter the Course</a>
    </td></tr></table>
    <p style="font-size:13px; line-height:1.6; color:#8A8275; margin-top:24px; text-align:center;">
      Keep this code private — it's tied to your purchase and grants lifetime access to
      every lesson, performance track, and the Armonía Connect Studio.
    </p>
  `);

  return resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: 'Your Armonía Connect access code is here',
    html,
  });
}

// Used for admin-generated codes (complimentary individual access, or classroom
// codes) — same access-code delivery as a real purchase, minus any "payment
// received" language since no payment happened here.
export async function sendGeneratedCodeEmail({ to, code, codeType }) {
  const isClassroom = codeType === 'classroom';
  const intro = isClassroom
    ? `You've been given classroom access to Armonía Connect — built for use on a shared screen with your students. Enter the school and teacher name it asks for on first login, and you're set.`
    : `You've been given complimentary access to Armonía Connect. Your access code is below — this is your key into the course site and the Armonía Connect Studio.`;
  const note = isClassroom
    ? `This code supports multiple students logging in at once from the same classroom, and doesn't require single-device binding the way an individual student code does. It also skips a couple of features (Community, and the Thank You & Credits page) that are meant for individual students only.`
    : `Keep this code private — it's tied to this access grant and works exactly like a purchased code, including full access to every lesson, performance track, and the Armonía Connect Studio.`;
  const html = emailShell(`
    <h1 style="font-size:24px; color:#F2EBD9; margin:0 0 16px;">${isClassroom ? 'Classroom Access' : 'Welcome to Armonía Connect'}</h1>
    <p style="font-size:15px; line-height:1.6;">${intro}</p>
    <p style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#8A8275; margin:24px 0 6px; text-align:center;">${isClassroom ? 'Classroom Access Code' : 'Your Access Code'}</p>
    <p style="font-size:24px; letter-spacing:2px; color:#E8C97A; margin:0 0 24px; font-family:monospace; text-align:center;">${code}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#C9A84C; border-radius:2px;">
      <a href="${LOGIN_URL}" style="display:inline-block; color:#0E0D0B; padding:14px 32px; text-decoration:none; font-weight:600; letter-spacing:1px;">Enter the Course</a>
    </td></tr></table>
    <p style="font-size:13px; line-height:1.6; color:#8A8275; margin-top:24px; text-align:center;">${note}</p>
  `);

  return resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: isClassroom ? 'Your Armonía Connect classroom access code' : 'Your Armonía Connect access code is here',
    html,
  });
}

export async function sendAdminVerificationEmail({ to, verifyUrl }) {
  const html = emailShell(`
    <h1 style="font-size:22px; color:#F2EBD9; margin:0 0 16px;">Verify your login email</h1>
    <p style="font-size:15px; line-height:1.6;">
      Click below to confirm this is your email address for your Armonía Connect admin account.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0;"><tr><td style="background:#C9A84C; border-radius:2px;">
      <a href="${verifyUrl}" style="display:inline-block; color:#0E0D0B; padding:14px 32px; text-decoration:none; font-weight:600; letter-spacing:1px;">Verify Email</a>
    </td></tr></table>
    <p style="font-size:13px; line-height:1.6; color:#8A8275; margin-top:24px;">
      This link expires in 1 hour. If you didn't request this, you can safely ignore it.
    </p>
  `);

  return resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: 'Verify your Armonía Connect admin email',
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
    subject: `[Armonía Connect Contact] ${subject} — ${firstName} ${lastName}`,
    html,
  });
}
