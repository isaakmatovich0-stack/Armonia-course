// One-off read-only preview build diagnostic. Never runs in production.
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Diagnostic is restricted to preview.');
const report = (step, data) => console.log('PF_DIAGNOSTIC ' + JSON.stringify({step, ...data}));
try {
  const { listProducts } = await import('../lib/store/db.js');
  const { listSyncProducts, listProductTemplates, startTemplateMockup, getTemplateMockup } = await import('../lib/suppliers/printful.js');
  const { matchPrintfulProduct, templateVariants, imagesForTask } = await import('../lib/store/mockup-photos.js');
  const rows = await listProducts();
  report('store', { products: rows.map(r => ({id:r.id, name:r.name, colors:r.colors})) });
  const products = await listSyncProducts();
  report('printful', { products: products.map(p => ({id:p.id, externalId:p.externalId, name:p.name, variants:p.variants.length, sample:p.variants.slice(0,2).map(v=>({catalogProductId:v.catalogProductId,variantId:v.variantId,colour:v.colour,size:v.size}))})) });
  const templates = await listProductTemplates();
  report('templates', { templates: templates.map(t=>({id:t.id, title:t.title, product_id:t.product_id,variants:t.available_variant_ids?.length})) });
  for (const row of rows) {
    const p = matchPrintfulProduct(products,row);
    const choices = templates.map(t=>({id:t.id,title:t.title,variants:templateVariants(row,p,t)})).filter(t=>Object.keys(t.variants).length);
    report('matching', {id:row.id, matched:!!p, matches:choices});
  }
  const row = rows.find(r=>r.id==='unisex-classic-tee');
  const pf = row && matchPrintfulProduct(products,row);
  const selected = templates.find(t=>String(t.title).toLowerCase()==='unisex classic tee' && Object.keys(templateVariants(row,pf,t)).length);
  if (!selected) throw new Error('No exact T-shirt template match; no task was started.');
  const all = templateVariants(row,pf,selected);
  const one = Object.fromEntries(Object.entries(all).slice(0,1));
  const key = await startTemplateMockup(selected.product_id,selected.id,Object.values(one));
  report('started', { template:selected.title, colours:Object.keys(one) });
  const deadline=Date.now()+120000;
  let task;
  do {
    await new Promise(r=>setTimeout(r,3000));
    task = await getTemplateMockup(key);
    report('task', {status:task.status});
  } while (task.status !== 'completed' && task.status !== 'failed' && Date.now()<deadline);
  if(task.status!=='completed') throw new Error(`Task ended ${task.status}`);
  const images=imagesForTask(task,one);
  report('results', {count:Object.keys(images).length, images:Object.fromEntries(Object.entries(images).map(([k,v])=>[k,{host:new URL(v.url).hostname,placement:v.placement}]))});
  for (const image of Object.values(images)) {
    const r = await fetch(image.url,{redirect:'error',signal:AbortSignal.timeout(15000)});
    const b = Buffer.from(await r.arrayBuffer());
    report('download', {status:r.status, type:r.headers.get('content-type'),bytes:b.length, png:b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))});
    const { supabase } = await import('../lib/supabase.js');
    const { storeMockup } = await import('../lib/store/mockup-storage.js');
    let saved;
    try {
      saved = await storeMockup(image.url, supabase.storage);
      const verify = await fetch(saved, { redirect:'error', signal:AbortSignal.timeout(15000) });
      report('storage', {status:verify.status, type:verify.headers.get('content-type')});
    } finally {
      if (saved) {
        const path = new URL(saved).pathname.split('/site-images/')[1];
        if (!path) throw new Error('Cannot find uploaded test path for cleanup');
        const {error} = await supabase.storage.from('site-images').remove([decodeURIComponent(path)]);
        report('cleanup', {ok: !error, error: error?.message});
      }
    }
  }
} catch (e) { report('error',{message:String(e.message).slice(0,400)}); }
