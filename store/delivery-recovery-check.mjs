import assert from 'node:assert/strict';
import {makeDeliveryWorker} from '../lib/store/delivery-recovery.js';

const order={id:'order-1',number:'AC-TEST',stripe_session_id:'cs_test_123',status:'paid',email:'buyer@example.test',items:[],amount_total:1000};
let jobs, emails, sends, now, sequence, failEmail, failSupplier;
const reset=()=>{now=0;sequence=0;emails=[];sends=0;failEmail=false;failSupplier=false;
 jobs=['receipt','supplier'].map(kind=>({id:kind,kind,order_id:order.id,state:'pending',snapshot:{...order},lease_until:0,started_at:null}));};
const worker=makeDeliveryWorker({
 claim:async()=>{const j=jobs.find(j=>j.state==='pending' && (j.next||0)<=now || j.state==='running' && j.lease_until<now);if(!j)return null;
  if(j.started_at!==null&&(j.kind==='supplier'||now-j.started_at>23*3600)) {j.state='review';return {...j};}
  j.state='running';j.lease_token=String(++sequence);j.lease_until=now+600;return {...j};},
 begin:async(id,token)=>{const j=jobs.find(j=>j.id===id);if(j.state!=='running'||j.lease_token!==token)return false;
  if(order.status!=='paid'){j.state='skipped';return false;}j.started_at ??= now;return true;},
 finish:async(job,state,error)=>{const j=jobs.find(j=>j.id===job.id);if(j.state!=='running'||j.lease_token!==job.lease_token)throw Error('lost lease');j.state=state;j.error=error;if(state==='pending')j.next=now+900;},
 loadOrder:async()=>({...order}),
 sendReceipt:async(payload)=>{emails.push(payload);if(failEmail)return {error:{message:'provider failure'}};return {data:{id:'mail'}};},
 submitSupplier:async()=>{sends++;if(failSupplier)throw Error('network lost');return {ok:true,status:'submitted'};},
 states:async()=>jobs.map(j=>({state:j.state,kind:j.kind})),
});
reset();await Promise.all([worker.runOrder(order.id),worker.runOrder(order.id)]);
assert.equal(sends,1);assert.equal(emails.length,1);assert.ok(jobs.every(j=>j.state==='done'));
reset();failEmail=true;await worker.runOrder(order.id);assert.equal(sends,1);assert.equal(jobs[0].state,'pending');assert.equal(jobs[1].state,'done');
const frozen=emails[0];now+=901;failEmail=false;await worker.runOrder(order.id);assert.equal(emails.length,2);assert.deepEqual(emails[1],frozen);assert.equal(emails[1].idempotencyKey,'store-receipt/cs_test_123');assert.equal(sends,1);
reset();failSupplier=true;await worker.runOrder(order.id);assert.equal(jobs[1].state,'review');await worker.runOrder(order.id);assert.equal(sends,1);
reset();const supplier=jobs[1];jobs[0].state='done';supplier.state='running';supplier.started_at=0;supplier.lease_until=600;now=601;
await worker.runOrder(order.id);assert.equal(supplier.state,'review');assert.equal(sends,0);
reset();jobs[1].state='done';jobs[0].state='running';jobs[0].started_at=0;jobs[0].lease_until=600;now=24*3600;
await worker.runOrder(order.id);assert.equal(jobs[0].state,'review');assert.equal(emails.length,0);
reset();order.status='refunded';await worker.runOrder(order.id);assert.equal(sends,0);assert.equal(emails.length,0);assert.ok(jobs.every(j=>j.state==='skipped'));order.status='paid';
console.log('Delivery recovery safety checks passed');
