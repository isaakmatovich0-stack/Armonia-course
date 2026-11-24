// Preview-only: inspect front/back mockup options, without changing stored data.
if (process.env.VERCEL_ENV !== 'preview') throw Error('Preview only');
const {getTemplateMockup}=await import('../lib/suppliers/printful.js');
const specs=[{id:'hoodie',product:146,template:110661786,variants:[5530,5594,5586,20570,16859]},{id:'jacket',product:661,template:110481369,variants:[16424,16434]}];
for(const s of specs){
 try {
  let r,j;for(let i=0;i<3;i++) {r=await fetch('https://api.printful.com/mockup-generator/create-task/'+s.product,{method:'POST',headers:{authorization:'Bearer '+process.env.PRINTFUL_API_TOKEN,'X-PF-Store-Id':process.env.PRINTFUL_STORE_ID,'content-type':'application/json'},body:JSON.stringify({product_template_id:s.template,variant_ids:s.variants,format:'png',option_groups:['Flat'],options:['Front','Back']}),signal:AbortSignal.timeout(20000)});j=await r.json();if(r.status!==429)break;await new Promise(x=>setTimeout(x,65000));}
  if(!r.ok)throw Error(JSON.stringify(j.error||j));
  let task;for(let i=0;i<50;i++){await new Promise(x=>setTimeout(x,3000));task=await getTemplateMockup(j.result.task_key);if(task.status==='completed'||task.status==='failed')break;}
  console.log('VIEW_TASK',JSON.stringify({id:s.id,status:task?.status,mockups:(task?.mockups||[]).map(m=>({placement:m.placement,variant_ids:m.variant_ids,extra:(m.extra||[]).map(x=>({title:x.title,option:x.option,option_group:x.option_group}))}))}));
 } catch(e){console.log('VIEW_ERROR',s.id,e.message)}
}
