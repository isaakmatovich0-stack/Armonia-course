// Vercel's Node runtime can parse req.body but restore the original bytes on
// the request stream. Stripe signatures must always use those original bytes,
// never JSON.stringify(req.body). The local dev server supplies a raw Buffer.
export async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let finished = false;
    const timer = setTimeout(() => finish(new Error('Raw request body unavailable.')), 3000);
    function finish(err, value) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      if (err) reject(err); else resolve(value);
    }
    function onData(chunk) {
      size += chunk.length;
      if (size > 1024 * 1024) return finish(new Error('Request body too large.'));
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    function onEnd() { finish(null, Buffer.concat(chunks)); }
    function onError(err) { finish(err); }
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}
