// Stripe caps each metadata value at 500 characters and each object at 50 keys.
// Split complete order lines into bounded chunks, never silently truncate them.
export function encodeCheckoutItems(items) {
  const result = {};
  let chunk = [];
  const flush = () => { if (chunk.length) { result[`items_${Object.keys(result).length}`] = JSON.stringify(chunk); chunk = []; } };
  for (const item of items) {
    if (JSON.stringify([item]).length > 480) throw new Error('A checkout item is too long.');
    if (JSON.stringify([...chunk, item]).length > 480) flush();
    chunk.push(item);
  }
  flush();
  if (Object.keys(result).length > 40) throw new Error('The bag has too many distinct items.');
  result.item_chunks = String(Object.keys(result).length);
  return result;
}

export function decodeCheckoutItems(metadata = {}) {
  if (metadata.items_json) return JSON.parse(metadata.items_json);
  const keys = Object.keys(metadata).filter(k => /^items_\d+$/.test(k)).sort((a,b) => Number(a.slice(6)) - Number(b.slice(6)));
  const count = Number(metadata.item_chunks);
  if (!Number.isInteger(count) || count < 1 || count !== keys.length || keys.some((key, i) => key !== `items_${i}`)) throw new Error('Incomplete checkout item metadata.');
  return keys.flatMap(key => JSON.parse(metadata[key]));
}
