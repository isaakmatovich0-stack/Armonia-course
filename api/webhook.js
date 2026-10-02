// POST /api/webhook
// Stripe calls this automatically the moment a payment succeeds.
// This is the heart of the automation: payment -> code -> database -> email.
//
// Requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Vercel env vars.
// STRIPE_WEBHOOK_SECRET comes from the Stripe Dashboard when you register
// this endpoint (see README step 4).

import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';
import { generateAccessCode } from '../lib/generateCode.js';
import { sendOrderConfirmationEmail } from '../lib/email.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Vercel needs the raw request body (not JSON-parsed) to verify the
// Stripe signature, so we disable the default body parser.
export const config = {
  api: { bodyParser: false },
};

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const rawBody = await buffer(req);
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const email = session.customer_details?.email;
    const name = session.customer_details?.name || null;
    const amount = session.amount_total;

    if (!email) {
      console.error('No email on completed session', session.id);
      return res.status(200).json({ received: true }); // ack Stripe, nothing more we can do
    }

    try {
      // Idempotency: if Stripe retries this webhook, don't issue a second code.
      const { data: existing } = await supabase
        .from('access_codes')
        .select('code')
        .eq('stripe_session_id', session.id)
        .maybeSingle();

      if (existing) {
        return res.status(200).json({ received: true, code: existing.code });
      }

      // Generate a code, retrying on the rare collision.
      let code;
      for (let attempt = 0; attempt < 5; attempt++) {
        code = generateAccessCode();
        const { data: clash } = await supabase
          .from('access_codes')
          .select('code')
          .eq('code', code)
          .maybeSingle();
        if (!clash) break;
      }

      const { error: insertError } = await supabase.from('access_codes').insert({
        code,
        email,
        name,
        stripe_session_id: session.id,
        amount_paid: amount,
      });

      if (insertError) throw insertError;

      await sendOrderConfirmationEmail({ to: email, name, code, amount });

      console.log(`Issued code ${code} to ${email}`);
    } catch (err) {
      console.error('Error processing checkout.session.completed:', err);
      // Still return 200 so Stripe doesn't hammer retries indefinitely;
      // the payment succeeded regardless — you'll see the error in Vercel logs.
    }
  }

  return res.status(200).json({ received: true });
}
