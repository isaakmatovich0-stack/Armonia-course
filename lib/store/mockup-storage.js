import crypto from 'node:crypto';

// Only fetch from Printful's documented mockup storage, without redirects.
// The task's result is supplied by Printful, not by the browser.
export async function storeMockup(url, storage, fetchImpl = fetch) {
  const parsed = new URL(url);
  const allowedHosts = new Set(['printful-upload.s3-accelerate.amazonaws.com', 'printful-mockups.s3.amazonaws.com']);
  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname) || parsed.username || parsed.password || parsed.port) throw new Error('Printful returned an unsupported image host.');
  const response = await fetchImpl(parsed.href, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok || !response.body) throw new Error('Could not download the Printful image.');
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > 5 * 1024 * 1024) throw new Error('The mockup is too large to save.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 5 * 1024 * 1024) { await reader.cancel(); throw new Error('The mockup is too large to save.'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  const buffer = Buffer.concat(chunks);
  const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!png && !jpg) throw new Error('Printful did not return a PNG or JPEG image.');
  const ext = png ? 'png' : 'jpg';
  const path = `store-mockups/${crypto.randomUUID()}.${ext}`;
  const bucket = storage.from('site-images');
  const { error } = await bucket.upload(path, buffer, { contentType: png ? 'image/png' : 'image/jpeg', upsert: false });
  if (error) throw new Error(`Could not save the mockup: ${error.message}`);
  const result = bucket.getPublicUrl(path);
  if (!result?.data?.publicUrl) throw new Error('Could not obtain the saved image URL.');
  return result.data.publicUrl;
}
