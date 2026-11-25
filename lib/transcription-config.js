// Validation shared by the public and authenticated transcription endpoints.
export const TRANSCRIPTION_KEY = 'transcription.catalog.v1';
const text = (value, max = 500) => typeof value === 'string' && value.length <= max;
const safeLink = value => !value || (text(value, 2048) && (/^\/(?!\/)/.test(value) || (() => { try { return new URL(value).protocol === 'https:'; } catch { return false; } })()));
const mediaFields = ['heroBackgroundVideo', 'heroBackgroundImage', 'screeningBackgroundImage', 'screeningYoutubeUrl', 'screeningTitle', 'screeningDescription', 'brandLogo', 'favicon', 'heroArtImage', 'featuredImage', 'insideImage', 'newsImage', 'defaultCover'];
const pieceFields = ['id', 'title', 'artist', 'instrument', 'description', 'cover', 'previewUrl', 'checkoutUrl', 'priceLabel', 'level', 'key', 'duration', 'parts', 'scorePreviewImage', 'youtubeUrl'];
const urlFields = new Set(['heroBackgroundVideo', 'heroBackgroundImage', 'screeningBackgroundImage', 'brandLogo', 'favicon', 'heroArtImage', 'featuredImage', 'insideImage', 'newsImage', 'defaultCover', 'cover', 'previewUrl', 'checkoutUrl', 'scorePreviewImage']);
function validYoutube(value) {
  if (!value) return true;
  if (!text(value, 2048)) return false;
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return true;
  try {
    const u = new URL(value); const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    if (u.protocol !== 'https:') return false;
    const parts = u.pathname.split('/').filter(Boolean);
    const id = host === 'youtu.be' ? parts[0] : (['youtube.com', 'youtube-nocookie.com'].includes(host) ? (u.pathname === '/watch' ? u.searchParams.get('v') : (['embed', 'shorts', 'live'].includes(parts[0]) ? parts[1] : '')) : '');
    return /^[A-Za-z0-9_-]{11}$/.test(id || '');
  } catch { return false; }
}
function record(value) { return value && typeof value === 'object' && !Array.isArray(value); }
export function validateTranscriptionConfig(config) {
  if (!record(config) || !record(config.media) || !Array.isArray(config.pieces) || !Array.isArray(config.news)) return 'Invalid suite content.';
  if (JSON.stringify(config).length > 200000) return 'Suite content is too large.';
  if (config.pieces.length > 200 || config.news.length > 100) return 'Too many pieces or videos.';
  if (!text(config.featuredId || '', 100)) return 'Invalid featured piece.';
  for (const key of mediaFields) {
    const value = config.media[key]; if (value == null) continue;
    if (!text(value, 2048)) return `Invalid ${key}.`;
    if (urlFields.has(key) && !safeLink(value)) return `Use an HTTPS or site-relative URL for ${key}.`;
    if (key === 'screeningYoutubeUrl' && !validYoutube(value)) return 'Use a valid YouTube URL or video ID for the screening room.';
  }
  const ids = new Set();
  for (const piece of config.pieces) {
    if (!record(piece) || !text(piece.id, 100) || !/^[a-zA-Z0-9_-]+$/.test(piece.id) || ids.has(piece.id) || !text(piece.title, 200) || !piece.title.trim() || typeof piece.sample !== 'boolean') return 'Each piece needs a title, unique ID, and sample setting.';
    ids.add(piece.id);
    for (const key of pieceFields) {
      const value = piece[key]; if (value == null) continue;
      if (!text(value, key === 'description' ? 3000 : 2048)) return `Invalid ${key} on ${piece.title}.`;
      if (urlFields.has(key) && !safeLink(value)) return `Use an HTTPS or site-relative URL for ${key} on ${piece.title}.`;
      if (key === 'youtubeUrl' && !validYoutube(value)) return `Invalid YouTube link on ${piece.title}.`;
    }
    if (piece.checkoutUrl && !/^https:\/\//i.test(piece.checkoutUrl)) return `Checkout link for ${piece.title} must use HTTPS.`;
  }
  if (config.featuredId && !ids.has(config.featuredId)) return 'Featured piece must be in the collection.';
  for (const item of config.news) {
    if (!record(item) || !text(item.title, 200) || !item.title.trim() || !text(item.label || '', 200) || !text(item.url, 2048) || !/^https:\/\//i.test(item.url) || !safeLink(item.url)) return 'Each performance needs a title and an HTTPS video URL.';
  }
  return null;
}
