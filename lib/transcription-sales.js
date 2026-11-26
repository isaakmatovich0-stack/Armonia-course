import crypto from 'node:crypto';
import { TRANSCRIPTION_KEY, validateTranscriptionConfig } from './transcription-config.js';

export const SALES_BUCKET = 'transcription-purchases';
export const salesEnabled = () => process.env.TRANSCRIPTION_CHECKOUT_ENABLED === 'true';
export const salesConfigured = () => salesEnabled() && Boolean(process.env.STRIPE_SECRET_KEY && process.env.RESEND_API_KEY && (process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET_STORE));
export const isOrderId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const isPieceId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);

export async function readPublicCatalog(db) {
  const { data, error } = await db.from('site_content').select('value').eq('key', TRANSCRIPTION_KEY).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const config = JSON.parse(data.value);
  if (validateTranscriptionConfig(config)) throw new Error('Invalid catalog');
  return config;
}

// A caller-provided random UUID is reused when the browser retries. Stripe's
// idempotency key and the DB primary key both use it, preventing extra
// sessions on retry. Each order snapshots its asset and price before checkout.
export async function startTranscriptionCheckout({db, stripe, pieceId, orderId, siteUrl}) {
  if (!isPieceId(pieceId) || !isOrderId(orderId)) throw new Error('Invalid checkout request.');
  const {data: previous, error: readError} = await db.from('transcription_sale_orders').select('*').eq('id', orderId).maybeSingle();
  if (readError) throw readError;
  let order = previous;
  if (order && order.piece_id !== pieceId) throw new Error('Checkout request does not match the selected piece.');
  if (!order) {
    const config = await readPublicCatalog(db);
    const piece = config?.pieces.find(item => item.id === pieceId && item.sample === false);
    const {data: product, error} = await db.from('transcription_sale_products').select('price_cents,asset_path,enabled').eq('piece_id', pieceId).maybeSingle();
    if (error) throw error;
    if (!piece || !product?.enabled || !Number.isInteger(product.price_cents) || product.price_cents < 50 || !product.asset_path) throw new Error('This transcription is not available for purchase.');
    const row = {id:orderId, piece_id:pieceId, piece_title:piece.title, price_cents:product.price_cents, asset_path:product.asset_path, state:'awaiting_payment'};
    const inserted = await db.from('transcription_sale_orders').insert(row).select('*').maybeSingle();
    if (inserted.error) {
      if (inserted.error.code !== '23505') throw inserted.error;
      const found = await db.from('transcription_sale_orders').select('*').eq('id',orderId).maybeSingle();
      if (found.error) throw found.error;
      order = found.data;
      if (!order || order.piece_id !== pieceId) throw new Error('Checkout request conflict.');
    } else order = inserted.data;
  }
  if (order.state !== 'awaiting_payment') throw new Error('This purchase has already been processed.');
  let session;
  if (order.stripe_session_id) session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
  else {
    const file = await db.storage.from(SALES_BUCKET).download(order.asset_path);
    if (file.error || !file.data) throw new Error('Score unavailable; checkout is disabled.');
    const bytes = Buffer.from(await file.data.arrayBuffer());
    if (bytes.length > 3 * 1024 * 1024 || bytes.subarray(0,5).toString() !== '%PDF-') throw new Error('Score is not a valid PDF.');
    session = await stripe.checkout.sessions.create({mode:'payment', payment_method_types:['card'],
      line_items:[{price_data:{currency:'usd',product_data:{name:order.piece_title},unit_amount:order.price_cents},quantity:1}],
      metadata:{source:'armonia-transcription', order_id:order.id},
      success_url:`${siteUrl}/transcription/?checkout=success&piece=${encodeURIComponent(order.piece_id)}`, cancel_url:`${siteUrl}/transcription/?checkout=cancelled`},
      {idempotencyKey:`transcription-checkout/${order.id}`});
    const saved = await db.from('transcription_sale_orders').update({stripe_session_id:session.id,updated_at:new Date().toISOString()}).eq('id',order.id).is('stripe_session_id',null).select('*').maybeSingle();
    if (saved.error) throw saved.error;
    if (!saved.data) {
      const found = await db.from('transcription_sale_orders').select('*').eq('id',order.id).maybeSingle();
      if (found.error || found.data?.stripe_session_id !== session.id) throw new Error('Checkout session could not be recorded.');
    }
  }
  if (session.status !== 'open' || !session.url) throw new Error('This checkout is no longer open. Start a new purchase.');
  return {url:session.url};
}

// Send exactly one attachment per paid order, claiming the row before calling
// the provider. An uncertain/crashed send is never automatically replayed:
// operators must check the provider and handle it manually.
export async function deliverTranscription({db, session, send}) {
  const id = session?.metadata?.order_id;
  if (session?.metadata?.source !== 'armonia-transcription' || !isOrderId(id)) return {ignored:true};
  if (session.payment_status !== 'paid') return {ignored:true};
  const email = session.customer_details?.email || session.customer_email;
  if (!email || typeof email !== 'string' || email.length > 254) throw new Error('Paid checkout has no customer email.');
  const {data:order,error} = await db.from('transcription_sale_orders').select('*').eq('id',id).maybeSingle();
  if (error) throw error;
  if (!order || order.stripe_session_id !== session.id || session.amount_total !== order.price_cents || session.currency !== 'usd') throw new Error('Paid checkout does not match a recorded order.');
  if (order.state === 'sent') return {sent:true,duplicate:true};
  if (order.state === 'review') return {review:true};
  if (order.state === 'sending') throw new Error('Delivery already in progress or requires review.');
  const claimed = await db.from('transcription_sale_orders').update({state:'sending',customer_email:email,updated_at:new Date().toISOString()}).eq('id',id).eq('state','awaiting_payment').select('*').maybeSingle();
  if (claimed.error) throw claimed.error;
  if (!claimed.data) throw new Error('Delivery was claimed by another worker.');
  try {
    const file = await db.storage.from(SALES_BUCKET).download(order.asset_path);
    if (file.error || !file.data) throw new Error('Private score file could not be retrieved.');
    const buffer = Buffer.from(await file.data.arrayBuffer());
    if (buffer.length > 3 * 1024 * 1024 || buffer.subarray(0,5).toString() !== '%PDF-') throw new Error('Private score is not a valid PDF under 3 MB.');
    const result = await send({to:email, title:order.piece_title, content:buffer, idempotencyKey:`transcription-delivery/${id}`});
    if (!result || result.skipped || result.error || !result.data?.id) throw new Error('Email provider did not confirm acceptance.');
    const updated = await db.from('transcription_sale_orders').update({state:'sent',resend_id:result.data.id,last_error:null,updated_at:new Date().toISOString()}).eq('id',id).eq('state','sending');
    if (updated.error) throw updated.error;
    return {sent:true};
  } catch (err) {
    const update = await db.from('transcription_sale_orders').update({state:'review',last_error:'Delivery requires manual review; verify email provider before resending.',updated_at:new Date().toISOString()}).eq('id',id).eq('state','sending');
    if (update.error) throw update.error;
    console.error('[transcription] delivery requires manual review:', err.message);
    return {review:true};
  }
}

export function newAssetPath(pieceId) { return `${pieceId}/${crypto.randomUUID()}.pdf`; }
