import { deliverTranscription } from './transcription-sales.js';

// Reconcile recorded sessions only. Never create a checkout or replay a send
// whose provider outcome is unknown. Stripe is authoritative for payment.
export async function reconcileTranscriptionOrders({ db, stripe, send, notify, now = new Date(), limit = 100 }) {
  const cutoff = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const query = await db.from('transcription_sale_orders').select('id,stripe_session_id,state,updated_at').eq('state','awaiting_payment').lt('updated_at',cutoff).order('updated_at',{ascending:true}).limit(limit);
  if (query.error) throw query.error;
  const issues = [];
  let checked = 0, recovered = 0;
  for (const order of query.data || []) {
    checked++;
    try {
      if (!order.stripe_session_id) { issues.push('An older checkout has no recorded Stripe session.'); continue; }
      const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
      if (session.payment_status !== 'paid') continue;
      const paymentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
      if (!paymentId) throw new Error('Paid session has no payment intent');
      const payment = await stripe.paymentIntents.retrieve(paymentId, {expand:['latest_charge']});
      const charge = payment.latest_charge;
      if (payment.status !== 'succeeded' || !charge || typeof charge !== 'object' || charge.refunded || charge.disputed || charge.amount_refunded !== 0) {
        issues.push('A paid session needs payment/refund review before delivery.'); continue;
      }
      const outcome = await deliverTranscription({db, session, send});
      if (outcome.sent) recovered++;
      else issues.push('A paid session requires delivery review.');
    } catch (err) {
      console.error('[transcription] reconciliation failed:', err.message);
      issues.push('A checkout could not be reconciled.');
    } finally {
      // Rotate old unpaid and problematic rows to avoid starving newer orders.
      // Do not overwrite a webhook's transition out of awaiting_payment.
      const touched = await db.from('transcription_sale_orders').update({updated_at:now.toISOString()}).eq('id',order.id).eq('state','awaiting_payment');
      if (touched.error) throw touched.error;
    }
  }
  const attention = await db.from('transcription_sale_orders').select('id,state').in('state',['review','sending']).lt('updated_at',cutoff).limit(limit);
  if (attention.error) throw attention.error;
  const attentionCount = (attention.data || []).length;
  if (attentionCount) issues.push(`${attentionCount} delivery order(s) require review.`);
  if ((query.data || []).length === limit || attentionCount === limit) issues.push('The reconciliation batch limit was reached; additional orders may need review.');
  if (issues.length) {
    const result = await notify({issues, idempotencyKey:`transcription-alert/${now.toISOString().slice(0,10)}`});
    if (!result || result.skipped || result.error || !result.data?.id) throw new Error('Reconciliation alert was not accepted');
  }
  return {checked, recovered, attention:attentionCount, issues:issues.length};
}
