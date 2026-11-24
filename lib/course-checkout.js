// Stripe sends account-wide Checkout events to both webhooks. Only grant
// access for an explicitly identified course checkout, never a store order.
const HISTORIC_COURSE_LINKS = new Set([
  'https://buy.stripe.com/28EfZg5XZajU6Qx1GhbAs00',
  'https://buy.stripe.com/fZuaEWbij63E1wdgBbbAs01',
]);

export async function isCourseCheckout(session, {stripe, supabase}) {
  if (session.metadata?.source === 'armonia-store' || session.metadata?.cart_id) return false;
  if (session.metadata?.source === 'armonia-course') return true;
  const id = typeof session.payment_link === 'string' ? session.payment_link : session.payment_link?.id;
  if (!id) return false;
  const link = await stripe.paymentLinks.retrieve(id);
  if (HISTORIC_COURSE_LINKS.has(link.url)) return true;
  const {data, error} = await supabase.from('site_content').select('value').eq('key', 'sale.stripe_link').maybeSingle();
  if (error) throw error;
  return Boolean(data?.value && data.value === link.url);
}

export function isStoreCheckout(session) {
  return session.metadata?.source === 'armonia-store' || Boolean(session.metadata?.cart_id);
}
