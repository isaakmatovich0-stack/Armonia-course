import assert from 'node:assert/strict';
import { reconcileTranscriptionOrders } from '../lib/transcription-reconcile.js';

const now = new Date('2026-11-26T12:00:00Z');
const old = '2026-11-25T00:00:00Z';
const ids = ['cc111111-1111-4111-8111-111111111111','cc222222-2222-4222-8222-222222222222','cc333333-3333-4333-8333-333333333333','cc444444-4444-4444-8444-444444444444','cc555555-5555-4555-8555-555555555555'];
const rows = ids.map((id,i) => ({id,piece_title:'Sample',price_cents:500,asset_path:'test.pdf',state:i===4?'review':'awaiting_payment',stripe_session_id:i===3?null:`cs_${i}`,updated_at:old}));
const db={storage:{from(){return {async download(){return {data:new Blob([Buffer.from('%PDF-mock')]),error:null}}}}},from(){
  let filters=[], op='read', payload, max=100;
  const execute=()=>{
    let found=rows.filter(row=>filters.every(([key,verb,value])=>verb==='eq'?row[key]===value:verb==='lt'?row[key]<value:value.includes(row[key]))).slice(0,max);
    if(op==='update') found.forEach(row=>Object.assign(row,payload));
    return {data:found.map(row=>({...row})),error:null};
  };
  const q={select(){return q},eq(k,v){filters.push([k,'eq',v]);return q},lt(k,v){filters.push([k,'lt',v]);return q},in(k,v){filters.push([k,'in',v]);return q},order(){return q},limit(v){max=v;return q},update(v){op='update';payload=v;return q},async maybeSingle(){const r=execute();return {...r,data:r.data[0]||null}},then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject)}};return q;
}};
const sessions={cs_0:{id:'cs_0',metadata:{source:'armonia-transcription',order_id:ids[0]},payment_status:'paid',amount_total:500,currency:'usd',payment_intent:'pi_good',customer_details:{email:'test@example.test'}},cs_1:{id:'cs_1',payment_status:'unpaid'},cs_2:{id:'cs_2',metadata:{source:'armonia-transcription',order_id:ids[2]},payment_status:'paid',amount_total:500,currency:'usd',payment_intent:'pi_refunded'}};
const stripe={checkout:{sessions:{async retrieve(id){return sessions[id]}}},paymentIntents:{async retrieve(id){return {status:'succeeded',latest_charge:{refunded:id==='pi_refunded',disputed:false,amount_refunded:id==='pi_refunded'?500:0}}}}};
let sends=0, alerts=0;
const result=await reconcileTranscriptionOrders({db,stripe,now,send:async()=>{sends++;return {data:{id:'email_1'}}},notify:async({issues,idempotencyKey})=>{alerts++;assert.equal(idempotencyKey,'transcription-alert/2026-11-26');assert(issues.length>=3);return {data:{id:'alert'}}}});
assert.equal(result.checked,4);assert.equal(result.recovered,1);assert.equal(result.attention,1);assert.equal(sends,1);assert.equal(alerts,1);
assert.equal(rows[0].state,'sent');assert.equal(rows[1].state,'awaiting_payment');assert.equal(rows[2].state,'awaiting_payment');assert.equal(rows[3].updated_at,now.toISOString());assert.equal(rows[4].state,'review');
const empty=await reconcileTranscriptionOrders({db,stripe,now,send:async()=>{throw Error('must not resend')},notify:async()=>({data:{id:'alert'}})});
assert.equal(empty.checked,0);assert.equal(empty.attention,1);
console.log('Reconciliation safely recovers paid orders, skips refunded/unpaid orders, and alerts on uncertain states (mocked).');
