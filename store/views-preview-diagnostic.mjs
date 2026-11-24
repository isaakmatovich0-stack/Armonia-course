// Preview-only staging. Copies generated views to storage, never updates catalogue.
if (process.env.VERCEL_ENV !== 'preview') throw Error('Preview only');
const {getTemplateMockup}=await import('../lib/suppliers/printful.js');
const {storeMockup}=await import('../lib/store/mockup-storage.js');
const {supabase}=await import('../lib/supabase.js');
const headers={authorization:'Bearer '+process.env.PRINTFUL_API_TOKEN,'X-PF-Store-Id':process.env.PRINTFUL_STORE_ID,'content-type':'application/json'};
const req=async(path,body)=>{for(let i=0;i<3;i++){const r=await fetch('https://api.printful.com'+path,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const j=await r.json();if(r.status===429){await new Promise(x=>setTimeout(x,65000));continue;}if(!r.ok)throw Error(JSON.stringify(j.error||j));return j;}throw Error('rate limited')};
const sleep=ms=>new Promise(x=>setTimeout(x,ms));
for (const s of [{id:'tee',product:438,template:110481475,variants:{Maroon:12634,Black:11546,Navy:11561}},{id:'hoodie',product:146,template:110661786,variants:{Black:5530,Navy:5594,Maroon:5586,'Forest Green':20570,Charcoal:16859}}]){
 try{const start=await req('/mockup-generator/create-task/'+s.product,{product_template_id:s.template,variant_ids:Object.values(s.variants),format:'png',option_groups:['Flat'],options:['Front','Back']});let task;for(let i=0;i<40;i++){await sleep(3000);task=await getTemplateMockup(start.result.task_key);if(task.status!=='pending')break;}if(task.status!=='completed')throw Error('task '+task.status);
 for(const [colour,id] of Object.entries(s.variants)){const m=task.mockups.filter(m=>m.variant_ids.includes(id));const back=s.id==='tee'?m.find(m=>m.placement==='back')?.mockup_url:m.flatMap(m=>m.extra||[]).find(x=>x.option==='Back'&&x.option_group==='Flat')?.url;if(!back)throw Error('no back for '+colour);console.log('STAGED',JSON.stringify({product:s.id,colour,side:'back',url:await storeMockup(back,supabase.storage)}));}
 }catch(e){console.log('ERROR',s.id,e.message)}
}
try { const j=await req('/v2/mockup-tasks',{format:'png',products:[{source:'product_template',product_template_id:110481369,catalog_variant_ids:[16424,16434],mockup_style_ids:[5031,5032]}]});console.log('JACKET_TASK',JSON.stringify(j.data));if(j.data?.[0]?.id){let t;for(let i=0;i<40;i++){await sleep(3000);t=await req('/v2/mockup-tasks?id='+j.data[0].id);if(t.data?.[0]?.status!=='pending')break;}for(const v of t.data?.[0]?.catalog_variant_mockups||[])for(const m of v.mockups||[])console.log('JACKET_VIEW',JSON.stringify({variant:v.catalog_variant_id,style:m.style_id,placement:m.placement,url:await storeMockup(m.mockup_url,supabase.storage)}));console.log('JACKET_STATUS',t.data?.[0]?.status,JSON.stringify(t.data?.[0]?.failure_reasons||[]));}}
catch(e){console.log('ERROR jacket',e.message)}
