// Preview-only: inspect an already-rendered sticker mockup. Never changes data.
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
import sharp from 'sharp';
const { supabase } = await import('../lib/supabase.js');
const { data, error } = await supabase.storage.from('site-images').download('store-mockups/08b0a5d3-7480-4a92-bc18-3773dc35992d.png');
if(error) throw error;
const buffer=Buffer.from(await data.arrayBuffer());
const {data:p,info}=await sharp(buffer).resize(200,200,{fit:'inside'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
let clear=0, opaque=0;for(let i=3;i<p.length;i+=4){if(p[i]===0)clear++;if(p[i]===255)opaque++;}
console.log('STICKER_METRICS',JSON.stringify({info,first:[...p.subarray(0,4)],clear,opaque}));
console.log('STICKER_THUMB', (await sharp(buffer).resize(160,160,{fit:'inside'}).webp({quality:35}).toBuffer()).toString('base64'));
