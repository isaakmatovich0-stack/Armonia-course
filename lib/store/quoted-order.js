// A quoted checkout fixes the delivery destination on its PaymentIntent.
// Never replace it with the payer's billing address if Stripe is unavailable.
export async function withQuotedShipping(session, stripeApi) {
  if (session.metadata?.fixed_shipping_address !== 'payment_intent') return session;
  const id = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (!id || !stripeApi) throw new Error('Quoted checkout has no payment intent.');
  const intent = await stripeApi.paymentIntents.retrieve(id);
  const address = intent.shipping?.address;
  if (!intent.shipping?.name || !address?.line1 || !address.city || !address.state || !address.postal_code || address.country !== 'US') {
    throw new Error('Quoted checkout has no valid shipping destination.');
  }
  return { ...session, shipping_details: intent.shipping };
}
