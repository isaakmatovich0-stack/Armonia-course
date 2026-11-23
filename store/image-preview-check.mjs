// Temporary preview-only photo diagnostic; reads images, never changes data.
if(process.env.VERCEL_ENV!=='preview') throw Error('Preview only');
import fs from 'node:fs';import vm from 'node:vm';import sharp from 'sharp';
const {supabase}=await import('../lib/supabase.js');
const {data:rows,error}=await supabase.from('store_products').select('id,colors,images');if(error)throw error;
const {default:handler}=await import('../api/store/[...slug].js');
const context={};vm.runInNewContext(fs.readFileSync('public/store/photo-cutout.js','utf8'),context);
for(const row of rows)for(const [colour,original] of Object.entries(row.images||{})){
 if(!/^https:\/\//.test(original)) continue;
 const res={setHeader(){},status(code){this.code=code;return this},send(data){this.data=data;return this},json(data){this.data=data;return this}};
 try {
  await handler({method:'GET',url:'/api/store/photo?product='+encodeURIComponent(row.id)+'&colour='+encodeURIComponent(colour),headers:{}},res);
  if(res.code!==200)throw Error(`proxy ${res.code}`);
  const {data,info}=await sharp(res.data).resize({width:800,height:800,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const edge=[...data.subarray(0,4)];
  const cut=/white|ivory|cream|natural/i.test(colour)?false:context.__armoniaCutoutPixels(data,info.width,info.height);
  let clear=0;for(let i=3;i<data.length;i+=4)if(data[i]===0)clear++;
  console.log('IMAGE_REVIEW '+JSON.stringify({id:row.id,colour,status:res.code,w:info.width,h:info.height,edge,cut,clear:Math.round(100*clear/(info.width*info.height))}));
 } catch(e){console.log('IMAGE_REVIEW '+JSON.stringify({id:row.id,colour,error:e.message}));}
}
