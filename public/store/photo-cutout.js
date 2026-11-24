/* Conservative, non-destructive cutouts for product photos. Only near-uniform
   pale backgrounds connected to the edge are removed. If an image is complex,
   light-coloured, unavailable, or the operation is unsafe, leave it alone. */
(function () {
  'use strict';
  function cutout(data, width, height) {
    if (width < 8 || height < 8 || width * height > 2000000) return false;
    const n = width * height;
    const corners = [0, width - 1, (height - 1) * width, n - 1];
    const first = corners[0] * 4;
    const bg = [data[first], data[first + 1], data[first + 2]];
    const pale = (i) => {
      const p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2];
      return data[p + 3] > 245 && Math.min(r, g, b) >= 135 && Math.max(r, g, b) - Math.min(r, g, b) < 35 && Math.max(Math.abs(r-bg[0]), Math.abs(g-bg[1]), Math.abs(b-bg[2])) < 100;
    };
    const flatEdge = (i) => {
      const p = i * 4;
      return pale(i) && Math.min(data[p],data[p+1],data[p+2]) >= 210 && Math.max(Math.abs(data[p]-bg[0]), Math.abs(data[p+1]-bg[1]), Math.abs(data[p+2]-bg[2])) < 18;
    };
    if (!corners.every(flatEdge)) return false;
    // A busy or coloured frame is not a clean studio backdrop.
    let total = 0, similar = 0;
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 60))) {
      total += 2; if (flatEdge(x)) similar++; if (flatEdge((height - 1) * width + x)) similar++;
    }
    for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 60))) {
      total += 2; if (flatEdge(y * width)) similar++; if (flatEdge(y * width + width - 1)) similar++;
    }
    if (similar / total < .94) return false;
    const seen = new Uint8Array(n), queue = new Uint32Array(n);
    let head = 0, tail = 0;
    function add(i) { if (!seen[i] && pale(i)) { seen[i] = 1; queue[tail++] = i; } }
    for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
    for (let y = 1; y < height - 1; y++) { add(y * width); add(y * width + width - 1); }
    while (head < tail) {
      const i = queue[head++], x = i % width;
      if (x) add(i - 1); if (x + 1 < width) add(i + 1);
      if (i >= width) add(i - width); if (i + width < n) add(i + width);
    }
    // Reject empty scenes and masks that might have consumed the subject.
    if (tail < n * .08 || tail > n * .80) return false;
    for (let i = 0; i < tail; i++) {
      const p = queue[i] * 4;
      const distance = Math.max(Math.abs(data[p]-bg[0]), Math.abs(data[p+1]-bg[1]), Math.abs(data[p+2]-bg[2]));
      const alpha = Math.max(0, Math.min(1, (distance - 8) / 92));
      // Remove the pale backdrop's contribution from antialiased edge pixels,
      // rather than leaving a bright rectangular halo on the dark hero.
      if (alpha > 0) for (let c = 0; c < 3; c++) data[p+c] = Math.max(0, Math.min(255, (data[p+c] - bg[c] * (1-alpha)) / alpha));
      data[p+3] = Math.round(alpha * 255);
    }
    return true;
  }
  globalThis.__armoniaCutoutPixels = cutout;
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const cache = new Map(), state = new WeakMap();
  let timer;
  function hash(text) { let h = 2166136261; for (let i=0;i<text.length;i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0).toString(36); }
  async function makeCutout(src, product, colour, side) {
    // White/cream products can be indistinguishable from a white background.
    if (/white|ivory|cream|natural/i.test(colour)) return null;
    const query = new URLSearchParams({product, colour, side, v: hash(src)});
    const url = src.startsWith('/store/images/') ? src : '/api/store/photo?' + query;
    const res = await fetch(url, {signal: AbortSignal.timeout(15000)});
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d', {willReadFrequently:true});
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (!cutout(image.data, canvas.width, canvas.height)) return null;
      ctx.putImageData(image, 0, 0);
      const result = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      return result ? URL.createObjectURL(result) : null;
    } finally { bitmap.close(); }
  }
  function scan() {
    for (const img of document.querySelectorAll('img[data-photo-product][data-photo-colour]')) {
      const src = img.getAttribute('src'), product = img.dataset.photoProduct, colour = img.dataset.photoColour, side = img.dataset.photoSide || 'front';
      const old = state.get(img);
      if (!src || !(/^https?:/i.test(src) || src.startsWith('/store/images/'))) continue;
      if (old && old.src === src && old.product === product && old.colour === colour && old.side === side) {
        if (old.result) { img.setAttribute('data-cutout','true'); img.setAttribute('src',old.result); }
        continue;
      }
      img.removeAttribute('data-cutout');
      img.removeAttribute('data-cutout-source');
      const entry = {src, product, colour, side}; state.set(img, entry);
      const key = JSON.stringify([src,product,colour,side]);
      // Bound memory in long sessions with many uploaded/replaced images.
      if (!cache.has(key)) {
        if (cache.size >= 50) continue;
        cache.set(key, makeCutout(src,product,colour,side).catch(() => null));
      }
      cache.get(key).then((result) => {
        if (!result || state.get(img) !== entry || img.getAttribute('src') !== src || img.dataset.photoProduct !== product || img.dataset.photoColour !== colour || (img.dataset.photoSide || 'front') !== side) return;
        entry.result = result;
        img.setAttribute('data-cutout-source',src);
        img.setAttribute('data-cutout','true');
        img.setAttribute('src',result);
      });
    }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(scan, 100); }
  new MutationObserver(schedule).observe(document.documentElement, {childList:true,subtree:true,attributes:true,attributeFilter:['src','data-photo-live','data-photo-product','data-photo-colour','data-photo-side']});
  schedule();
})();
