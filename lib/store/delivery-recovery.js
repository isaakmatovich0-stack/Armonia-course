// Durable side-effect worker. The DB trigger creates jobs in the same
// transaction as a new order. Supplier uncertainty goes to review, never a
// blind re-send; Resend receives a stable idempotency key and frozen payload.
import {supabase} from '../supabase.js';
import {sendStoreOrderConfirmation} from '../email.js';
import {submitToSupplier} from './fulfilment.js';

export function makeDeliveryWorker({claim, begin, finish, loadOrder, sendReceipt, submitSupplier, states}) {
  async function runOne(orderId = null) {
    const job = await claim(orderId);
    if (!job) return null;
    if (job.state === 'review') return {state:'review', kind:job.kind};
    let started = false;
    try {
      const order = await loadOrder(job.order_id);
      if (!order) throw new Error('Order not found');
      if (!await begin(job.id, job.lease_token)) return {state:'skipped', kind:job.kind};
      started = true;
      if (job.kind === 'receipt') {
        const snapshot = job.snapshot;
        if (!snapshot?.email) {
          await finish(job,'review','No customer email; review order.');
          return {state:'review',kind:job.kind};
        }
        const result = await sendReceipt({to:snapshot.email, name:snapshot.name, orderNumber:snapshot.number,
          items:snapshot.items || [], subtotalCents:snapshot.amount_subtotal, shippingCents:snapshot.amount_shipping,
          taxCents:snapshot.amount_tax, discountCents:snapshot.amount_discount, totalCents:snapshot.amount_total,
          shippingAddress:snapshot.shipping_address, promoCode:snapshot.promo_code, idempotencyKey:`store-receipt/${snapshot.stripe_session_id}`});
        if (result?.error || result?.skipped || !result?.data?.id) throw new Error('Email provider did not confirm acceptance');
      } else if (job.kind === 'supplier') {
        const result = await submitSupplier(order);
        if (!result?.ok || result.status === 'partially_submitted') {
          await finish(job,'review','Supplier submission requires review; check supplier before retrying.');
          return {state:'review',kind:job.kind};
        }
      } else throw new Error('Unknown delivery job type');
      await finish(job,'done',null);
      return {state:'done',kind:job.kind};
    } catch (error) {
      // Before begin() there was no external request. Once supplier work has
      // begun, even a timeout or DB error may hide a charge or created order.
      const state = started && job.kind === 'supplier' ? 'review' : 'pending';
      await finish(job,state, state === 'review' ? 'Supplier outcome uncertain; verify with supplier before retrying.' : 'Delivery failed; retry pending.');
      console.error('[delivery] job failed:', job.kind, error.message);
      return {state,kind:job.kind};
    }
  }
  async function runOrder(orderId) {
    for (let i=0;i<2;i++) {
      const result=await runOne(orderId);
      if (!result) break;
    }
    return states(orderId);
  }
  return {runOne,runOrder};
}

async function claim(orderId) {
  const {data,error}=await supabase.rpc('store_claim_delivery_job',{p_order_id:orderId});
  if(error) throw error;
  return data?.[0] || null;
}
async function begin(id,token) {
  const {data,error}=await supabase.rpc('store_begin_delivery_job',{p_job_id:id,p_token:token});
  if(error) throw error;
  return data === true;
}
async function finish(job,state,errorMessage) {
  const {data,error}=await supabase.from('store_delivery_jobs').update({state,last_error:errorMessage,lease_token:null,lease_until:null,updated_at:new Date().toISOString(), ...(state === 'pending' ? {next_attempt_at:new Date(Date.now()+15*60_000).toISOString()} : {})})
    .eq('id',job.id).eq('state','running').eq('lease_token',job.lease_token).select('id');
  if(error || !data?.length) throw new Error('Delivery result could not be recorded');
}
async function loadOrder(id) {
  const {data,error}=await supabase.from('store_orders').select('*').eq('id',id).single();
  if(error) throw error;
  return data;
}
async function states(id) {
  const {data,error}=await supabase.from('store_delivery_jobs').select('kind,state').eq('order_id',id);
  if(error) throw error;
  if(data.length!==2) throw new Error('Delivery jobs missing');
  return data;
}
export const deliveryWorker=makeDeliveryWorker({claim,begin,finish,loadOrder,sendReceipt:sendStoreOrderConfirmation,submitSupplier:submitToSupplier,states});
export async function deliveryStatesForOrders(ids) {
  if(!ids.length) return [];
  const {data,error}=await supabase.from('store_delivery_jobs').select('order_id,kind,state,started_at,lease_until,last_error').in('order_id',ids);
  if(error) throw error;
  return data || [];
}
