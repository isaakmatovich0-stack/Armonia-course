(() => {
  'use strict';
  const root = document.getElementById('transcriptionSales');
  let api, data, catalog, busy = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const status = (message, error=false) => { const node=root.querySelector('.ts-sales-status'); if (node) {node.textContent=message;node.classList.toggle('error',error);} };
  const lock = value => {busy=value;root.querySelectorAll('input,button').forEach(node=>node.disabled=value);};
  function render() {
    const sales = new Map(data.products.map(item=>[item.piece_id,item]));
    const pieces = (catalog?.pieces || []).filter(item=>item.sample === false);
    const cards=pieces.map(piece=>{const sale=sales.get(piece.id);return `<div class="ts-card" data-sale="${esc(piece.id)}"><div class="ts-card-body"><strong>${esc(piece.title)}</strong><p class="ts-help">${sale?.asset_path ? 'A private PDF is uploaded.' : 'No PDF uploaded.'}</p><div class="ts-grid" style="margin-top:12px"><label class="ts-field">Price in USD<input data-price type="text" inputmode="decimal" value="${sale ? (sale.price_cents/100).toFixed(2) : ''}" placeholder="e.g. 15.00"></label><label class="ts-field">Private PDF (up to 3 MB)<input data-pdf type="file" accept="application/pdf"></label><label class="ts-field ts-span"><input data-enabled type="checkbox" ${sale?.enabled?'checked':''}>Enable this product for purchase when checkout is active</label></div><input type="hidden" data-path value="${esc(sale?.asset_path || '')}"><div class="ts-card-actions"><button type="button" class="ts-button primary" data-sale-save="${esc(piece.id)}">Save price &amp; PDF</button></div></div></div>`}).join('');
    const row=order=>`<tr><td>${esc(order.piece_title)}<br><small>Order: ${esc(order.id)}<br>Stripe session: ${esc(order.stripe_session_id || 'not recorded')}<br>Resend: ${esc(order.resend_id || 'not recorded')}</small></td><td>${esc(order.customer_email || '—')}</td><td>${esc(order.state)}<br><small>${esc(order.last_error || '')}</small></td><td>${esc(order.created_at)}</td></tr>`;
    const attention=(data.attention || []).map(row).join('');
    const pending=(data.pending || []).map(row).join('');
    const orders=data.orders.map(row).join('');
    root.innerHTML=`<div class="ts-group" style="margin-top:28px"><div class="ts-group-body"><div class="ts-header"><div><h2>PDF sales &amp; email delivery</h2><p>${data.checkoutEnabled?'Checkout is enabled.':'Checkout is globally OFF. No new digital purchases can be started.'}</p></div><div class="ts-actions"><button type="button" class="ts-button" data-sales-action="reload">Refresh</button><button type="button" class="ts-button" data-sales-action="close">Close</button></div></div><p class="ts-sales-status ts-status" role="status"></p><div class="ts-warning">Save a real product in the collection first. Uploaded PDFs are private, but customers receive an attachment by email after a verified payment. A delivery in “sending” or “review” needs manual attention; verify the email provider before sending anything again.</div><div class="ts-cards">${cards || '<p class="ts-empty">No saved real products yet. Add and save a transcription first.</p>'}</div><h3 style="margin-top:28px;color:var(--gold-light)">Delivery needs attention</h3><p class="ts-help">Up to the 100 oldest unresolved deliveries. ${data.reconciliationEnabled ? 'Daily reconciliation is configured; verify that its cron and alerts work.' : 'Daily reconciliation is off.'}</p><div style="overflow-x:auto"><table><thead><tr><th>Piece</th><th>Customer</th><th>State</th><th>Updated</th></tr></thead><tbody>${attention || '<tr><td colspan="4">No unresolved deliveries.</td></tr>'}</tbody></table></div><h3 style="margin-top:28px;color:var(--gold-light)">Oldest awaiting payment</h3><p class="ts-help">Unpaid or abandoned checkouts may appear here. Verify payment with Stripe before taking action.</p><div style="overflow-x:auto"><table><thead><tr><th>Piece / IDs</th><th>Customer</th><th>State</th><th>Created</th></tr></thead><tbody>${pending || '<tr><td colspan="4">None.</td></tr>'}</tbody></table></div><h3 style="margin-top:28px;color:var(--gold-light)">Recent digital orders</h3><p class="ts-help">Review delivery problems before resending; payment and email outcomes can be uncertain.</p><div style="overflow-x:auto"><table><thead><tr><th>Piece</th><th>Customer</th><th>State</th><th>Created</th></tr></thead><tbody>${orders || '<tr><td colspan="4">No digital orders.</td></tr>'}</tbody></table></div></div></div>`;
  }
  async function load(fetcher) {
    if (busy) return; api=fetcher || api; root.innerHTML='<p class="ts-status">Loading sales settings…</p>'; busy=true;
    try {const result=await Promise.all([api('/api/admin/transcription-sales'),api('/api/admin/transcription-content')]);data=result[0];catalog=result[1].config;render();root.scrollIntoView({behavior:'smooth',block:'start'});}
    catch(err){root.innerHTML=`<div class="ts-group"><div class="ts-group-body"><p class="ts-status error">${esc(err.message)}</p><button type="button" class="ts-button" data-sales-action="reload">Try again</button></div></div>`;}
    finally {busy=false;}
  }
  root.addEventListener('click',async event=>{
    const control=event.target.closest('button'); if(!control || busy)return;
    if(control.dataset.salesAction==='close'){root.replaceChildren();return;}
    if(control.dataset.salesAction==='reload'){load();return;}
    if(!control.dataset.saleSave)return;
    const card=control.closest('[data-sale]'), pieceId=control.dataset.saleSave, raw=card.querySelector('[data-price]').value.trim();
    if(!/^\d{1,5}(?:\.\d{1,2})?$/.test(raw)){status('Enter a USD price with up to two decimal places.',true);return;}
    const [dollars,cents='']=raw.split('.');const priceCents=Number(dollars)*100+Number(cents.padEnd(2,'0'));
    if(priceCents<50 || priceCents>1000000){status('Price must be between $0.50 and $10,000.',true);return;}
    const input=card.querySelector('[data-pdf]'),file=input.files[0];let assetPath=card.querySelector('[data-path]').value;
    if(file && (file.type !== 'application/pdf' || file.size>3*1024*1024)){status('Choose a PDF under 3 MB.',true);return;}
    if(!file && !assetPath){status('Choose a PDF before saving sales settings.',true);return;}
    const enabled=card.querySelector('[data-enabled]').checked;lock(true);status(file?'Uploading private PDF…':'Saving sales settings…');
    try {
      if(file){const pdfBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read PDF.'));reader.readAsDataURL(file);});const uploaded=await api('/api/admin/transcription-upload-pdf',{method:'POST',body:JSON.stringify({pieceId,pdfBase64})});assetPath=uploaded.assetPath;card.querySelector('[data-path]').value=assetPath;}
      await api('/api/admin/transcription-sales',{method:'PUT',body:JSON.stringify({pieceId,priceCents,assetPath,enabled})});
      status('Sales settings saved.');input.value='';
    }catch(err){status(err.message,true);}finally{lock(false);}
  });
  window.transcriptionSalesAdmin={open:load};
})();
