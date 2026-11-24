// Stripe course checkout notifications. Only verified, paid course sessions
// create an access code; merchandise events are handled by the store webhook.
import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';
import { generateAccessCode } from '../lib/generateCode.js';
import { sendOrderConfirmationEmail } from '../lib/email.js';
import { rawBody } from '../lib/store/raw-body.js';
import { isCourseCheckout } from '../lib/course-checkout.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
export const config = { api: { bodyParser: false } };

async function findCode(sessionId) {
  const {data, error} = await supabase.from('access_codes')
    .select('code,email,name,amount_paid,access_email_sent_at')
    .eq('stripe_session_id', sessionId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getOrCreateCode(session) {
  let existing = await findCode(session.id);
  if (existing) return existing;
  const email = session.customer_details?.email || session.customer_email;
  if (!email) throw new Error('Paid course session has no email address');
  for (let i = 0; i < 5; i++) {
    const row = {code: generateAccessCode(), email, name: session.customer_details?.name || null,
      stripe_session_id: session.id, amount_paid: session.amount_total};
    const {error} = await supabase.from('access_codes').insert(row);
    if (!error) return {...row, access_email_sent_at: null};
    if (error.code !== '23505') throw error;
    // A concurrent webhook may have inserted this session; otherwise the
    // generated code collided, so choose a different code.
    existing = await findCode(session.id);
    if (existing) return existing;
  }
  throw new Error('Could not allocate a unique access code');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  let payload;
  try { payload = await rawBody(req); }
  catch (err) { console.error('Webhook body unavailable:', err.message); return res.status(400).send('Webhook body unavailable'); }
  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_WEBHOOK_SECRET_STORE].filter(Boolean);
  if (!secrets.length) return res.status(503).send('Webhook not configured');
  let event = null;
  for (const secret of secrets) {
    try { event = stripe.webhooks.constructEvent(payload, req.headers['stripe-signature'], secret); break; } catch { /* try next key */ }
  }
  if (!event) return res.status(400).send('Invalid webhook signature');
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return res.status(200).json({received:true});
  const session = event.data.object;
  if (!['paid', 'no_payment_required'].includes(session.payment_status)) return res.status(200).json({received:true, ignored:'not paid'});
  try {
    if (!await isCourseCheckout(session, {stripe, supabase})) return res.status(200).json({received:true, ignored:'not a course checkout'});
    const row = await getOrCreateCode(session);
    if (!row.access_email_sent_at) {
      const result = await sendOrderConfirmationEmail({to:row.email, name:row.name, code:row.code,
        amount:row.amount_paid, idempotencyKey:`course-access/${session.id}`});
      if (!result || result.skipped || result.error || !result.data?.id) throw new Error('Access email was not accepted');
      const {error} = await supabase.from('access_codes').update({access_email_sent_at:new Date().toISOString()}).eq('stripe_session_id', session.id);
      if (error) throw error;
    }
    return res.status(200).json({received:true});
  } catch (err) {
    // Stripe retries, preserving the existing code and Resend idempotency key.
    console.error('Course checkout processing failed:', err.message);
    return res.status(500).json({error:'Course checkout processing failed'});
  }
}
