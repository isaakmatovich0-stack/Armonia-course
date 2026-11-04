// Handles all outbound email via Resend.
// Requires RESEND_API_KEY in Vercel env vars.
// FROM_EMAIL must be on a domain you've verified in Resend (see README).

import { Resend } from 'resend';

// Constructed lazily (and only when a key exists) so a missing RESEND_API_KEY
// never takes down an endpoint that merely imports this module — the store,
// for example, still browses and sells fine without email configured.
let resendClient = null;
function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

async function sendEmail(params) {
  const client = getResend();
  if (!client) {
    console.warn(`[email] RESEND_API_KEY is not set — skipped "${params.subject}"`);
    return { skipped: true };
  }
  return client.emails.send(params);
}

const FROM_EMAIL = process.env.FROM_EMAIL || 'Armonía Connect <no-reply@armonia-mariachi.com>';
// The actual live login / code-entry page. Hardcoded and NOT read from an
// environment variable — this exact link was confirmed correct, and an
// env var was the repeated source of this pointing at the wrong page.
const LOGIN_URL = 'https://www.armoniaconnect.com/course/';
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

  return sendEmail({
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

  return sendEmail({
    from: FROM_EMAIL,
    to,
    subject: isClassroom ? 'Your Armonía Connect classroom access code' : 'Your Armonía Connect access code is here',
    html,
  });
}

// For requests covering multiple students at once — e.g. a director asking
// for individual codes for their whole section. One email, every code
// listed, rather than spamming the recipient with N separate emails.
export async function sendGeneratedCodeBatchEmail({ to, codes, codeType }) {
  const isClassroom = codeType === 'classroom';
  const codeRows = codes.map(c => `<p style="font-size:18px; letter-spacing:1.5px; color:#E8C97A; margin:0 0 8px; font-family:monospace; text-align:center;">${c}</p>`).join('');
  const html = emailShell(`
    <h1 style="font-size:24px; color:#F2EBD9; margin:0 0 16px;">${codes.length} Access Codes</h1>
    <p style="font-size:15px; line-height:1.6;">You've been given ${codes.length} ${isClassroom ? 'classroom' : 'individual student'} access codes to Armonía Connect — one for each student. Distribute one to each student below.</p>
    <p style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#8A8275; margin:24px 0 10px; text-align:center;">Your Access Codes</p>
    ${codeRows}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 0;"><tr><td style="background:#C9A84C; border-radius:2px;">
      <a href="${LOGIN_URL}" style="display:inline-block; color:#0E0D0B; padding:14px 32px; text-decoration:none; font-weight:600; letter-spacing:1px;">Enter the Course</a>
    </td></tr></table>
    <p style="font-size:13px; line-height:1.6; color:#8A8275; margin-top:24px; text-align:center;">Each code is separate and tied to one student — keep this list private and hand out one code per person.</p>
  `);

  return sendEmail({
    from: FROM_EMAIL,
    to,
    subject: `Your ${codes.length} Armonía Connect access codes`,
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

  return sendEmail({
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

  return sendEmail({
    from: FROM_EMAIL,
    to: SUPPORT_EMAIL,
    reply_to: email,
    subject: `[Armonía Connect Contact] ${subject} — ${firstName} ${lastName}`,
    html,
  });
}

/* ════════════════════════════════════════════════════════════════════════
   STORE EMAILS
   Sent by the store's Stripe webhook (api/store/[...slug].js → checkout.session.completed)
   and by the storefront's contact + newsletter forms.
   ════════════════════════════════════════════════════════════════════════ */

const STORE_NAME = 'Armonia Connect';
const STORE_URL = 'https://www.armoniaconnect.com/store/';

function storeShell(bodyHtml) {
  return `
  <div style="background:#F6F3EB; padding:40px 22px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="max-width:560px; margin:0 auto; background:#FFFFFF; border:1px solid #E4E0D4;">
      <div style="background:#142529; padding:28px 32px;">
        <p style="margin:0; letter-spacing:5px; font-size:12px; color:#E5BE73; text-transform:uppercase;">Armonia</p>
        <p style="margin:4px 0 0; letter-spacing:5px; font-size:12px; color:#F6F3EB; text-transform:uppercase;">Connect</p>
      </div>
      <div style="padding:34px 32px 30px; color:#142529;">
        ${bodyHtml}
      </div>
      <div style="padding:20px 32px 26px; border-top:1px solid #EDE9DE; color:#7C857D; font-size:11px; line-height:1.7;">
        <p style="margin:0;">Good things. Better together.</p>
        <p style="margin:6px 0 0;">Questions? Reply to this email or write to ${SUPPORT_EMAIL}.</p>
      </div>
    </div>
  </div>`;
}

function centsToMoney(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
}

/**
 * Order receipt + confirmation. Sent the moment Stripe confirms payment.
 */
export async function sendStoreOrderConfirmation({ to, name, orderNumber, items = [], subtotalCents, shippingCents, taxCents, discountCents, totalCents, shippingAddress, promoCode }) {
  const firstName = name ? String(name).split(' ')[0] : 'there';
  const rows = items
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 0; border-bottom:1px solid #F0EDE4; font-size:14px; color:#142529;">
          ${item.name}${item.color || item.size ? `<br><span style="font-size:11px; color:#7C857D;">${[item.color, item.size].filter(Boolean).join(' / ')}</span>` : ''}
        </td>
        <td style="padding:10px 0; border-bottom:1px solid #F0EDE4; font-size:13px; color:#7C857D; text-align:center;">× ${item.quantity}</td>
        <td style="padding:10px 0; border-bottom:1px solid #F0EDE4; font-size:14px; color:#142529; text-align:right; white-space:nowrap;">${centsToMoney((item.unitPriceCents || 0) * item.quantity)}</td>
      </tr>`,
    )
    .join('');

  const addressLines = shippingAddress
    ? [
        shippingAddress.line1,
        shippingAddress.line2,
        [shippingAddress.city, shippingAddress.state, shippingAddress.postal_code].filter(Boolean).join(', '),
        shippingAddress.country,
      ]
        .filter(Boolean)
        .map((line) => `<p style="margin:2px 0; font-size:13px; color:#4C5A50;">${line}</p>`)
        .join('')
    : '';

  const html = storeShell(`
    <p style="margin:0 0 6px; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#8C8A7C;">Order ${orderNumber}</p>
    <h1 style="margin:0 0 14px; font-family:Georgia,'Times New Roman',serif; font-size:26px; font-weight:500; color:#142529;">Thanks, ${firstName}. That looks good on you.</h1>
    <p style="margin:0 0 22px; font-size:14px; line-height:1.7; color:#4C5A50;">
      Your order is confirmed and payment of <strong>${centsToMoney(totalCents)}</strong> went through.
      We pack and ship from the United States within 2–4 business days, and you'll get tracking by email as soon as it's on its way.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      ${rows}
      ${discountCents ? `<tr><td style="padding:8px 0; font-size:13px; color:#3B6B45;">Discount${promoCode ? ` (${promoCode})` : ''}</td><td></td><td style="padding:8px 0; font-size:13px; color:#3B6B45; text-align:right;">−${centsToMoney(discountCents)}</td></tr>` : ''}
      <tr>
        <td style="padding:8px 0; font-size:13px; color:#4C5A50;" colspan="2">Subtotal</td>
        <td style="padding:8px 0; font-size:13px; color:#4C5A50; text-align:right;">${centsToMoney(subtotalCents)}</td>
      </tr>
      <tr>
        <td style="padding:4px 0; font-size:13px; color:#4C5A50;" colspan="2">Shipping</td>
        <td style="padding:4px 0; font-size:13px; color:#4C5A50; text-align:right;">${shippingCents ? centsToMoney(shippingCents) : 'Free'}</td>
      </tr>
      <tr>
        <td style="padding:4px 0; font-size:13px; color:#4C5A50;" colspan="2">Sales tax</td>
        <td style="padding:4px 0; font-size:13px; color:#4C5A50; text-align:right;">${taxCents ? centsToMoney(taxCents) : '—'}</td>
      </tr>
      <tr>
        <td style="padding:14px 0 0; border-top:1px solid #E4E0D4; font-size:15px; color:#142529;" colspan="2"><strong>Total</strong></td>
        <td style="padding:14px 0 0; border-top:1px solid #E4E0D4; font-size:15px; color:#142529; text-align:right;"><strong>${centsToMoney(totalCents)}</strong></td>
      </tr>
    </table>
    <div style="background:#F6F3EB; padding:18px 20px; margin-top:10px;">
      <p style="margin:0 0 8px; font-size:10px; letter-spacing:1.6px; text-transform:uppercase; color:#8C8A7C;">Shipping to</p>
      <p style="margin:2px 0; font-size:13px; color:#142529;">${name || ''}</p>
      ${addressLines}
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px auto 0;">
      <tr><td style="background:#142529;">
        <a href="${STORE_URL}" style="display:inline-block; padding:14px 30px; color:#F6F3EB; text-decoration:none; font-size:12px; letter-spacing:1.6px; text-transform:uppercase;">Visit the store</a>
      </td></tr>
    </table>
    <p style="margin:22px 0 0; font-size:12px; line-height:1.7; color:#8C8A7C; text-align:center;">
      Unworn items can be returned within 30 days of delivery — just reply to this email and we'll send a prepaid label.
    </p>
  `);

  return sendEmail({
    from: FROM_EMAIL,
    to,
    subject: `Your Armonia Connect order ${orderNumber} is confirmed`,
    html,
  });
}

/**
 * New-order alert to the shop inbox, so nothing waits on a dashboard check.
 */
export async function sendStoreOrderNotification({ orderNumber, name, email, items = [], totalCents, shippingAddress }) {
  const list = items.map((item) => `${item.quantity} × ${item.name}${item.color ? ` (${item.color}${item.size ? ` / ${item.size}` : ''})` : ''}`).join('<br>');
  const address = shippingAddress
    ? [shippingAddress.line1, shippingAddress.line2, [shippingAddress.city, shippingAddress.state, shippingAddress.postal_code].filter(Boolean).join(', ')]
        .filter(Boolean)
        .join('<br>')
    : '';
  const html = emailShell(`
    <h1 style="font-size:20px; color:#F2EBD9; margin:0 0 16px;">New store order ${orderNumber}</h1>
    <p style="font-size:14px; margin:4px 0;"><strong>Total:</strong> ${centsToMoney(totalCents)}</p>
    <p style="font-size:14px; margin:4px 0;"><strong>Customer:</strong> ${name || '—'} &lt;${email || '—'}&gt;</p>
    <p style="font-size:14px; line-height:1.7; margin-top:14px;">${list}</p>
    <p style="font-size:13px; line-height:1.7; color:#8A8275; margin-top:14px;">Ship to:<br>${address}</p>
    <p style="font-size:12px; color:#8A8275; margin-top:22px;">Reply to this message to email the customer directly.</p>
  `);
  return sendEmail({
    from: FROM_EMAIL,
    to: SUPPORT_EMAIL,
    reply_to: email || undefined,
    subject: `[Store] New order ${orderNumber} — ${centsToMoney(totalCents)}`,
    html,
  });
}

/**
 * Store contact form (real one, at /store/contact and in the store modal).
 */
export async function sendStoreContactNotification({ name, email, subject, message }) {
  const html = emailShell(`
    <h1 style="font-size:20px; color:#F2EBD9; margin:0 0 16px;">New store message</h1>
    <p style="font-size:14px; margin:4px 0;"><strong>From:</strong> ${name} (${email})</p>
    <p style="font-size:14px; margin:4px 0;"><strong>Subject:</strong> ${subject || 'Store enquiry'}</p>
    <p style="font-size:15px; line-height:1.6; margin-top:16px; white-space:pre-wrap;">${message}</p>
  `);
  return sendEmail({
    from: FROM_EMAIL,
    to: SUPPORT_EMAIL,
    reply_to: email,
    subject: `[Store] ${subject || 'Store enquiry'} — ${name}`,
    html,
  });
}
