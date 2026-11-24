// One-off preview inspection, never updates products or touches the hat.
if (process.env.VERCEL_ENV !== 'preview') throw Error('Preview only');
const {storeMockup}=await import('../lib/store/mockup-storage.js');
const {supabase}=await import('../lib/supabase.js');
const headers={authorization:'Bearer '+process.env.PRINTFUL_API_TOKEN,'X-PF-Store-Id':process.env.PRINTFUL_STORE_ID,'content-type':'application/json'};
const req=async(path,body)=>{for(let i=0;i<3;i++){const r=await fetch('https://api.printful.com'+path,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const j=await r.json();if(r.status===429){await new Promise(x=>setTimeout(x,65000));continue;}if(!r.ok)throw Error(JSON.stringify(j.error||j));return j;}throw Error('rate limited')};
try {
 const detail=await req('/store/variants/5656384205');
 const files=(detail.result?.sync_variant||detail.result)?.files||[];
 console.log('JACKET_FILES',JSON.stringify(files.map(f=>({type:f.type,hasUrl:!!f.url}))));
 const image=files.find(f=>f.type==='embroidery_chest_left')?.url || files.find(f=>f.type==='embroidery_chest_left')?.preview_url;
 if(!image) throw Error('No matching chest artwork found');
 const started=await req('/v2/mockup-tasks',{format:'png',products:[{source:'catalog',catalog_product_id:661,catalog_variant_ids:[16424,16434],mockup_style_ids:[5032],placements:[{placement:'embroidery_chest_left',technique:'embroidery',layers:[{type:'file',url:image}]}]}]});
 const id=started.data?.[0]?.id;if(!id)throw Error('No task ID');let task;
 for(let i=0;i<40;i++){await new Promise(x=>setTimeout(x,3000));task=(await req('/v2/mockup-tasks?id='+id)).data?.[0];if(task?.status!=='pending')break;}
 console.log('JACKET_STATUS',task?.status,JSON.stringify(task?.failure_reasons||[]));
 for(const v of task?.catalog_variant_mockups||[])for(const m of v.mockups||[])console.log('JACKET_VIEW',JSON.stringify({variant:v.catalog_variant_id,style:m.style_id,placement:m.placement,url:await storeMockup(m.mockup_url,supabase.storage)}));
} catch(e) {console.log('JACKET_ERROR',e.message)}
