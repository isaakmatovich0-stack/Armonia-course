// Checkout quotes and fulfilment must use the same validated destination.
import crypto from 'node:crypto';

export function shippingAddress(input) {
  const fields = ['name', 'line1', 'line2', 'city', 'state', 'postal_code'];
  const result = Object.fromEntries(fields.map(key => [key, String(input?.[key] || '').trim()]));
  result.state = result.state.toUpperCase();
  result.country = 'US';
  if (!result.name || !result.line1 || !result.city || !/^[A-Z]{2}$/.test(result.state) || !/^\d{5}(-\d{4})?$/.test(result.postal_code) || fields.some(key => result[key].length > 100)) {
    throw new Error('Enter your name and complete US shipping address, including a two-letter state and ZIP code.');
  }
  return result;
}

export function printfulRecipient(address) {
  return { name: address.name, address1: address.line1, address2: address.line2, city: address.city, state_code: address.state, zip: address.postal_code, country_code: address.country };
}

// The server recomputes the rate and cart before creating a payment session.
export function quoteFingerprint(address, lines, amountCents, discountCents = 0) {
  const items = lines.map(({ productId, color, colorName, size, quantity, unitPriceCents }) => ({ productId, color: colorName || color, size, quantity, unitPriceCents }));
  return crypto.createHash('sha256').update(JSON.stringify({ address, items, amountCents, discountCents })).digest('hex');
}
