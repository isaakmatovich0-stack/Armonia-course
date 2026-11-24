// Temporary read-only status check for the existing order. No financial or order mutations.
if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
const response = await fetch('https://api.printful.com/orders/189438251', {headers: {Authorization: `Bearer ${process.env.PRINTFUL_API_TOKEN}`, 'X-PF-Store-Id': process.env.PRINTFUL_STORE_ID}});
if (!response.ok) throw new Error(`Printful order lookup failed: ${response.status}`);
const {result} = await response.json();
if (result?.external_id !== 'AC-FVMXTA' || result?.id !== 189438251) throw new Error('Unexpected order');
console.log('ORDER_STATUS', JSON.stringify({id: result.id, status: result.status, error: result.error, items: result.items?.map(i => ({quantity: i.quantity})), shipments: result.shipments?.map(s => ({carrier: s.carrier, service: s.service, tracking_number: s.tracking_number, tracking_url: s.tracking_url, shipped_at: s.shipped_at}))}));
