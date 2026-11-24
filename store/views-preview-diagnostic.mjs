// Temporary preview-only investigation. Does not alter catalog or artwork.
if (process.env.VERCEL_ENV !== 'preview') throw Error('Preview only');
const {startTemplateMockup,getTemplateMockup,listProductTemplates} = await import('../lib/suppliers/printful.js');
const specs=[{id:'tee',product:438,template:110481475,variants:[12634,11546,11561]},{id:'jacket',product:661,template:110481369,variants:[16424,16434]},{id:'hoodie',product:146,template:110661786,variants:[5530,5594,5586,20570,16859]}];
const templates=await listProductTemplates();
for(const s of specs){
 try {
 const template=templates.find(t=>Number(t.id)===s.template && Number(t.product_id)===s.product);
 if(!template||s.variants.some(v=>!template.available_variant_ids.map(Number).includes(v)))throw Error('template or variants no longer match');
 const res=await fetch('https://api.printful.com/mockup-generator/printfiles/'+s.product,{headers:{authorization:'Bearer '+process.env.PRINTFUL_API_TOKEN,'X-PF-Store-Id':process.env.PRINTFUL_STORE_ID},signal:AbortSignal.timeout(20000)});
 const details=await res.json();console.log('VIEW_OPTIONS',JSON.stringify({id:s.id,code:res.status,options:details.result?.options,option_groups:details.result?.option_groups,placements:details.result?.available_placements}));
 const taskKey=await startTemplateMockup(s.product,s.template,s.variants);let task;
 for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,3000));task=await getTemplateMockup(taskKey);if(task.status==='completed'||task.status==='failed')break;}
 console.log('VIEW_TASK',JSON.stringify({id:s.id,status:task?.status,mockups:(task?.mockups||[]).map(m=>({placement:m.placement,variant_ids:m.variant_ids,extra:(m.extra||[]).map(x=>({title:x.title,option:x.option,option_group:x.option_group}))}))}));
 }catch(e){console.log('VIEW_ERROR',s.id,e.message)}
}
