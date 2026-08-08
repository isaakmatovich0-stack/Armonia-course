// POST /api/checkout
// Called when the visitor clicks "Enroll Now — $100" on the flyer page.
// Creates a real Stripe Checkout Session and returns the URL to redirect to.
//
// Requires STRIPE_SECRET_KEY in Vercel env vars.

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SITE_URL = process.env.SITE_URL || 'https://armonia-mariachi.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Armonía — TMEA All-State Mariachi Course',
              description: 'Full course access with Isaak Matovich, plus Armonía Connect.',
            },
            unit_amount: 10000, // $100.00 — change here AND in the flyer page copy if price changes
          },
          quantity: 1,
        },
      ],
      // Stripe collects the buyer's email during checkout automatically.
      success_url: `${SITE_URL}/enrolled?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/#pricing`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
}
