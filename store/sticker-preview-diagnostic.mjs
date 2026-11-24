// One-off preview-only diagnostic: render the saved sticker template and
// preserve the temporary mockup for visual review. Never updates the catalog.
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
const { listProductTemplates, startTemplateMockup, getTemplateMockup } = await import('../lib/suppliers/printful.js');
const { storeMockup } = await import('../lib/store/mockup-storage.js');
const { supabase } = await import('../lib/supabase.js');
const template = (await listProductTemplates()).find(t => String(t.id) === '110481640');
if (!template || Number(template.product_id) !== 358 || !template.available_variant_ids.map(Number).includes(10164)) throw new Error('Saved sticker template or variant does not match');
console.log('STICKER_TEMPLATE', JSON.stringify({id:template.id,title:template.title,product:template.product_id}));
const taskKey = await startTemplateMockup(template.product_id, template.id, [10164]);
let task;
for(let i=0;i<50;i++) { await new Promise(r=>setTimeout(r,3000)); task=await getTemplateMockup(taskKey); if(task.status==='completed'||task.status==='failed') break; }
if(task?.status!=='completed') throw new Error('Printful task not completed: '+task?.status);
const images = (task.mockups || []).filter(m => m.variant_ids?.map(Number).includes(10164));
if(!images.length) throw new Error('No sticker mockup for selected variant');
for(const image of images.slice(0,4)) {
  const url=await storeMockup(image.mockup_url,supabase.storage);
  console.log('STICKER_PREVIEW', JSON.stringify({placement:image.placement,url}));
}
