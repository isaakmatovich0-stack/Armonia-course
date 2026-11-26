(() => {
  'use strict';
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const state = { pieces: [], news: [], media: {}, sales: new Map(), featuredId: '', filter: 'All', search: '', saved: [] };
  const storageKey = 'armonia-transcription-saved-v1';
  const email = 'maestro.armoniaconnect@gmail.com';
  try { const saved = JSON.parse(localStorage.getItem(storageKey) || '[]'); if (Array.isArray(saved)) state.saved = saved.filter(id => typeof id === 'string'); } catch { /* storage can be blocked */ }
  const save = () => { try { localStorage.setItem(storageKey, JSON.stringify(state.saved)); } catch { /* still works for this visit */ } updateSavedCount(); };
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = String(text); return node; };
  const safeUrl = (value, { external = false } = {}) => {
    if (typeof value !== 'string' || !value.trim()) return '';
    try { const u = new URL(value, location.origin); if (u.protocol !== 'https:' && !(u.origin === location.origin && u.protocol === 'http:')) return ''; if (external && u.protocol !== 'https:') return ''; return u.href; } catch { return ''; }
  };
  function youtubeId(value) {
    if (typeof value !== 'string') return '';
    if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return '';
      const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
      let id = '';
      if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0];
      else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        const parts = url.pathname.split('/').filter(Boolean);
        id = url.pathname === '/watch' ? url.searchParams.get('v') : (['embed', 'shorts', 'live'].includes(parts[0]) ? parts[1] : '');
      }
      return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : '';
    } catch { return ''; }
  }
  function playYoutube(target, id, title) {
    const frame = el('iframe', 'youtube-frame');
    frame.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
    frame.title = title || 'YouTube performance';
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.allowFullscreen = true; frame.referrerPolicy = 'strict-origin-when-cross-origin';
    target.replaceChildren(frame); frame.focus();
  }
  function videoButton(target, id, title, label = 'PLAY PERFORMANCE') {
    const button = el('button', 'video-play-button', label + ' ▶'); button.type = 'button';
    button.setAttribute('aria-label', `Play ${title} on YouTube`);
    button.addEventListener('click', () => playYoutube(target, id, title)); target.append(button);
  }
  function configureMedia(media) {
    if (!media || typeof media !== 'object') return;
    state.media = media;
    const heroImage = safeUrl(media.heroBackgroundImage), screeningImage = safeUrl(media.screeningBackgroundImage);
    if (heroImage) document.documentElement.style.setProperty('--hero-image', `url(${JSON.stringify(heroImage)})`);
    if (screeningImage) document.documentElement.style.setProperty('--screening-image', `url(${JSON.stringify(screeningImage)})`);
    for (const [key, css] of [['heroArtImage','--hero-art-image'], ['insideImage','--inside-image']]) { const url = safeUrl(media[key]); if (url) document.documentElement.style.setProperty(css, `url(${JSON.stringify(url)})`); }
    for (const [key, selector] of [['featuredImage','#feature-image'], ['newsImage','#news-image']]) { const url = safeUrl(media[key]); if (url) $(selector).src = url; }
    const logo = safeUrl(media.brandLogo); if (logo) $$('.brand img, .record-label img').forEach(img => { img.src = logo; });
    const favicon = safeUrl(media.favicon); if (favicon) $('link[rel=icon]').href = favicon;
    const stage = $('#screening-player'); const id = youtubeId(media.screeningYoutubeUrl);
    if (id) {
      $('#screening-title').textContent = media.screeningTitle || 'The music comes alive.';
      $('#screening-description').textContent = media.screeningDescription || 'Watch the music come to life.';
      $('#screening-note').textContent = 'The video loads from YouTube when you press play.';
      $('.video-stage-content strong').textContent = media.screeningTitle || 'WATCH THE PERFORMANCE';
      $('.video-stage-content p').textContent = 'Press play to watch on YouTube.';
      videoButton(stage, id, media.screeningTitle || 'featured performance');
    }
    const bg = safeUrl(media.heroBackgroundVideo);
    const video = $('#hero-video');
    if (bg) {
      video.src = bg; video.hidden = false;
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) video.play().catch(() => {});
    }
  }
  const imageFor = piece => safeUrl(piece.cover) || safeUrl(state.media.defaultCover) || '/transcription/images/studio-editorial.jpg';
  function image(piece, className) { const img = el('img', className); img.src = imageFor(piece); img.alt = piece.sample !== false ? 'Illustrative sample artwork' : `Cover artwork for ${piece.title}`; img.loading = 'lazy'; img.addEventListener('error', () => { if (!img.dataset.fallback) { img.dataset.fallback = '1'; img.src = '/transcription/images/studio-editorial.jpg'; } }); return img; }
  const isSample = piece => piece.sample !== false;
  function updateSavedCount() { $$('.saved-count').forEach(node => node.textContent = String(state.saved.filter(id => state.pieces.some(p => p.id === id)).length)); }
  function toggleSaved(id) { state.saved = state.saved.includes(id) ? state.saved.filter(value => value !== id) : [...state.saved, id]; save(); }
  function showDialog(dialog) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); }
  function hideDialog(dialog) { if (typeof dialog.close === 'function' && dialog.open) dialog.close(); else dialog.removeAttribute('open'); dialog.querySelectorAll('iframe').forEach(frame => frame.remove()); }
  function mail(subject, body) { location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`; }
  const priceFor = piece => state.sales.has(piece.id) ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(state.sales.get(piece.id) / 100) : (piece.priceLabel || '');
  async function purchase(piece, button) {
    if (!crypto.randomUUID) { button.textContent = 'Please use a current browser'; return; }
    button.disabled = true; const old = button.textContent; button.textContent = 'OPENING CHECKOUT…';
    try {
      const key = `armonia-transcription-checkout/${piece.id}`;
      let orderId; try { orderId = sessionStorage.getItem(key); if (!orderId) { orderId = crypto.randomUUID(); sessionStorage.setItem(key,orderId); } } catch { throw new Error('Please enable browser storage to start checkout safely.'); }
      const response = await fetch('/api/transcription-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pieceId:piece.id,orderId})});
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not open checkout.');
      const url = new URL(data.url); if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('Checkout address is invalid.');
      location.assign(url.href);
    } catch (err) { button.disabled = false; button.textContent = old; const status = el('p','preview-note',err.message + ' If you already paid, contact us rather than starting another payment.'); button.parentElement.append(status); }
  }
  function renderProducts() {
    const grid = $('#product-grid'); grid.replaceChildren();
    const query = state.search.trim().toLocaleLowerCase();
    const filtered = state.pieces.filter(piece => (state.filter === 'All' || piece.instrument === state.filter) && (!query || [piece.title, piece.artist, piece.instrument, piece.description].some(value => String(value || '').toLocaleLowerCase().includes(query))));
    $('#results-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'PIECE' : 'PIECES'}`;
    $('#empty-state').hidden = filtered.length > 0;
    filtered.forEach((piece, index) => {
      const card = el('article', 'product-card');
      const cover = el('button', `product-image tone-${index % 4}`); cover.type = 'button'; cover.setAttribute('aria-label', `Preview ${piece.title}`); cover.append(image(piece));
      cover.append(el('span', 'card-badge', isSample(piece) ? 'EXAMPLE' : (piece.instrument || 'TRANSCRIPTION').toUpperCase()));
      cover.append(el('span', 'card-number', `0${index + 1}`.slice(-2)));
      cover.append(el('span', 'card-title-overlay', piece.title)); cover.append(el('span', 'card-arrow', '↗'));
      cover.addEventListener('click', () => openPiece(piece));
      const info = el('div', 'product-info'); const text = el('div'); text.append(el('h3', '', piece.title), el('p', '', piece.artist || piece.instrument || 'Transcription'));
      info.append(text, el('span', '', isSample(piece) ? 'SAMPLE' : (priceFor(piece) || 'VIEW PIECE'))); card.append(cover, info); grid.append(card);
    });
  }
  function openPiece(piece) {
    const dialog = $('#piece-dialog'); const content = $('#dialog-content'); content.replaceChildren();
    const grid = el('div', 'dialog-grid'); const artwork = el('div', 'dialog-image'); artwork.append(image(piece), el('span', 'dialog-image-label', 'The music lives on.'));
    const copy = el('div', 'dialog-copy'); copy.append(el('p', 'eyebrow', isSample(piece) ? 'EXAMPLE / PREVIEW ONLY' : 'THE TRANSCRIPTION SUITE'));
    const title = el('h2', '', piece.title); title.id = 'dialog-title'; copy.append(title, el('p', '', piece.artist || 'Armonia Connect'), el('p', '', piece.description || 'A piece from the Armonia Connect collection.'));
    const details = el('div', 'dialog-details'); [['INSTRUMENT', piece.instrument || '—'], ['PRICE', isSample(piece) ? 'Not for sale' : (priceFor(piece) || 'Ask for details')], ...(!isSample(piece) ? [['LEVEL', piece.level], ['KEY', piece.key], ['LENGTH', piece.duration], ['PARTS', piece.parts]].filter(([, value]) => typeof value === 'string' && value.trim()) : [])].forEach(([label, value]) => { const item = el('div'); item.append(el('span', '', label), el('strong', '', value)); details.append(item); }); copy.append(details);
    const actions = el('div', 'dialog-actions');
    const preview = safeUrl(piece.previewUrl); if (preview && !isSample(piece)) { const link = el('a', 'button button-outline', 'OPEN MUSIC PREVIEW ↗'); link.href = preview; link.target = '_blank'; link.rel = 'noopener noreferrer'; actions.append(link); }
    if (!isSample(piece) && state.sales.has(piece.id)) { const buy = el('button', 'button button-dark', `BUY FOR ${priceFor(piece)} ↗`); buy.type = 'button'; buy.addEventListener('click', () => purchase(piece,buy)); actions.append(buy); copy.append(el('p','dialog-delivery-note','After successful payment, the PDF is sent to the email used at checkout.')); }
    const checkout = safeUrl(piece.checkoutUrl, {external:true}); if (checkout && !isSample(piece) && !state.sales.has(piece.id)) { const link = el('a', 'button button-dark', 'PURCHASE PIECE ↗'); link.href = checkout; link.target = '_blank'; link.rel = 'noopener noreferrer'; actions.append(link); }
    const favorite = el('button', 'button button-outline', state.saved.includes(piece.id) ? 'SAVED ✓' : 'SAVE PIECE +'); favorite.type = 'button'; favorite.addEventListener('click', () => { toggleSaved(piece.id); favorite.textContent = state.saved.includes(piece.id) ? 'SAVED ✓' : 'SAVE PIECE +'; }); actions.append(favorite);
    const ask = el('button', 'button button-dark', isSample(piece) ? 'ASK ABOUT A TRANSCRIPTION ↗' : 'ASK ABOUT THIS PIECE ↗'); ask.type = 'button'; ask.addEventListener('click', () => { hideDialog(dialog); const form = $('#contact-form'); form.elements.type.value = isSample(piece) ? 'Custom transcription' : 'Question about a piece'; if (!isSample(piece)) form.elements.message.value = `Hi Isaak, I'd like to know more about ${piece.title}.`; $('#contact').scrollIntoView({behavior:'smooth'}); setTimeout(() => form.elements.name.focus(), 350); }); actions.append(ask); copy.append(actions);
    if (!isSample(piece)) {
      const score = safeUrl(piece.scorePreviewImage);
      if (score) { const panel = el('div', 'score-preview'); panel.append(el('span', 'preview-label', 'A LOOK AT THE MUSIC')); const scoreImage = el('img'); scoreImage.src = score; scoreImage.alt = `Score preview for ${piece.title}`; scoreImage.loading = 'lazy'; panel.append(scoreImage); copy.append(panel); }
      const videoId = youtubeId(piece.youtubeUrl);
      if (videoId) { const panel = el('div', 'piece-video'); panel.append(el('span', 'preview-label', 'HEAR THE ARRANGEMENT'), el('p', '', 'Watch the performance on YouTube.')); videoButton(panel, videoId, piece.title, 'WATCH VIDEO'); copy.append(panel); }
    }
    if (isSample(piece)) copy.append(el('p', 'preview-note', 'Example listing only. No real transcription or payment is attached.'));
    else if (!preview) copy.append(el('p', 'preview-note', 'A music preview has not been added for this piece yet.'));
    if (!isSample(piece) && !checkout && !state.sales.has(piece.id)) copy.append(el('p', 'preview-note', 'Online purchase is not configured for this piece. Get in touch to ask about availability.'));
    grid.append(artwork, copy); content.append(grid); showDialog(dialog);
  }
  function renderSaved() {
    const list = $('#saved-list'); list.replaceChildren(); const selected = state.saved.map(id => state.pieces.find(piece => piece.id === id)).filter(Boolean);
    if (!selected.length) list.append(el('p', 'preview-note', 'No saved pieces yet. Explore the collection and save a piece to see it here.'));
    selected.forEach(piece => { const row = el('div', 'saved-row'); row.append(image(piece, 'saved-thumb')); const details = el('div'); details.append(el('strong', '', piece.title), el('small', '', `${piece.instrument || 'Transcription'}${isSample(piece) ? ' · Example' : ''}`)); const remove = el('button', '', 'REMOVE'); remove.type = 'button'; remove.addEventListener('click', () => { toggleSaved(piece.id); renderSaved(); }); row.append(details, remove); list.append(row); });
    $('#ask-saved').disabled = !selected.some(piece => !isSample(piece));
  }
  function renderNews() {
    const grid = $('#news-grid'); grid.replaceChildren();
    let count = 0; state.news.forEach(item => { const href = safeUrl(item.url, {external:true}); if (!href || !item.title) return; const card = el('article', 'news-card'); card.append(el('span', '', item.label || 'PERFORMANCE JOURNAL'), el('h3', '', item.title)); const id = youtubeId(item.url); if (id) { const stage = el('div', 'news-video'); stage.append(el('p', '', 'WATCH THE PERFORMANCE')); videoButton(stage, id, item.title, 'PLAY VIDEO'); card.append(stage); } const link = el('a', '', id ? 'OPEN ON YOUTUBE ↗' : 'WATCH THE PERFORMANCE ↗'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); grid.append(card); count++; });
    $('#news-caption-status').textContent = count ? 'VIDEOS & STORIES FROM THE COMMUNITY' : 'YOUR VIDEOS & STORIES WILL APPEAR HERE';
  }
  async function init() {
    try {
      const response = await fetch('/api/transcription-content', {cache:'no-store'}); if (!response.ok) throw new Error('Catalog unavailable'); const result = await response.json();
      let data = result.config;
      if (!data) { const fallback = await fetch('/transcription/catalog.json', {cache:'no-cache'}); if (!fallback.ok) throw new Error('Catalog unavailable'); data = await fallback.json(); }
      state.pieces = Array.isArray(data.pieces) ? data.pieces.filter(p => p && typeof p.id === 'string' && typeof p.title === 'string') : [];
      state.news = Array.isArray(data.news) ? data.news : []; state.featuredId = data.featuredId || ''; configureMedia(data.media);
      const featured = state.pieces.find(piece => piece.id === state.featuredId) || state.pieces[0];
      $('#feature-title').textContent = featured ? featured.title : 'Your featured composition';
      $('#feature-open').disabled = !featured; $('#feature-open').addEventListener('click', () => { if (featured) openPiece(featured); });
      $('.demo-note').hidden = Boolean(featured && !isSample(featured));
      const hasExamples = state.pieces.some(isSample); $('.catalog-note > span:last-child').textContent = hasExamples ? 'EXAMPLE CONTENT — YOUR MUSIC COMING SOON' : 'CURATED WITH CARE';
      const filters = $('.filters'); const existing = new Set($$('.filter').map(button => button.dataset.filter));
      state.pieces.forEach(piece => { if (piece.instrument && !existing.has(piece.instrument)) { existing.add(piece.instrument); const button = el('button', 'filter', piece.instrument.toUpperCase()); button.type = 'button'; button.dataset.filter = piece.instrument; button.setAttribute('aria-pressed', 'false'); filters.append(button); } });
      try { const salesResponse = await fetch('/api/transcription-sales',{cache:'no-store'}); if (salesResponse.ok) { const salesData = await salesResponse.json(); if (Array.isArray(salesData.products)) salesData.products.forEach(item => { if (typeof item.piece_id === 'string' && Number.isInteger(item.price_cents) && item.price_cents >= 50) state.sales.set(item.piece_id,item.price_cents); }); } } catch { /* browsing stays available when sales are unavailable */ }
      renderProducts(); renderNews(); updateSavedCount();
    } catch { $('#product-grid').replaceChildren(el('p', 'preview-note', 'The collection could not be loaded. Please try again later.')); $('#results-count').textContent = 'UNAVAILABLE'; $('#feature-open').disabled = true; }
  }
  $('#search').addEventListener('input', event => { state.search = event.target.value; renderProducts(); });
  $('.filters').addEventListener('click', event => { const button = event.target.closest('.filter'); if (!button) return; state.filter = button.dataset.filter; $$('.filter').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); }); renderProducts(); });
  $('#clear-filters').addEventListener('click', () => { state.filter = 'All'; state.search = ''; $('#search').value = ''; $$('.filter').forEach(item => { const active = item.dataset.filter === 'All'; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); }); renderProducts(); });
  $('.search-trigger').addEventListener('click', () => { $('#catalog').scrollIntoView({behavior:'smooth'}); setTimeout(() => $('#search').focus(), 350); });
  document.addEventListener('keydown', event => { if (event.key === '/' && !event.metaKey && !event.ctrlKey && !/input|textarea|select/i.test(document.activeElement?.tagName || '') && !document.querySelector('dialog[open]')) { event.preventDefault(); $('.search-trigger').click(); } });
  $('.saved-trigger').addEventListener('click', () => { renderSaved(); showDialog($('#saved-dialog')); });
  $('[data-close-dialog]').addEventListener('click', () => hideDialog($('#piece-dialog'))); $('[data-close-saved]').addEventListener('click', () => hideDialog($('#saved-dialog')));
  $$('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) hideDialog(dialog); }));
  $('#ask-saved').addEventListener('click', () => { const titles = state.saved.map(id => state.pieces.find(p => p.id === id)).filter(piece => piece && !isSample(piece)).map(piece => `- ${piece.title} (${piece.instrument || 'Transcription'})`); if (titles.length) mail('Transcription suite enquiry', `Hi Isaak,\n\nI'd like to know more about these pieces:\n${titles.join('\n')}\n\nThank you!`); });
  $('#contact-form').addEventListener('submit', event => { event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return; const name = form.elements.name.value.trim(), from = form.elements.email.value.trim(), type = form.elements.type.value, message = form.elements.message.value.trim(); if (!name || !from || !message) { $('#contact-status').textContent = 'Please complete the form before continuing.'; return; } $('#contact-status').textContent = 'Your email app should open. Please send the prepared message there.'; mail(`Transcription Suite: ${type}`, `Name: ${name}\nEmail: ${from}\nRequest: ${type}\n\n${message}`); });
  const menu = $('.menu-toggle'); menu.addEventListener('click', () => { const nav = $('#mobile-menu'); nav.hidden = !nav.hidden; menu.setAttribute('aria-expanded', String(!nav.hidden)); menu.setAttribute('aria-label', nav.hidden ? 'Open menu' : 'Close menu'); }); $$('#mobile-menu a').forEach(link => link.addEventListener('click', () => { $('#mobile-menu').hidden = true; menu.setAttribute('aria-expanded', 'false'); menu.setAttribute('aria-label', 'Open menu'); }));
  const motionButton = $('.motion-toggle');
  motionButton.addEventListener('click', () => {
    const paused = !document.body.classList.contains('motion-paused');
    document.body.classList.toggle('motion-paused', paused);
    motionButton.setAttribute('aria-pressed', String(paused));
    motionButton.setAttribute('aria-label', paused ? 'Resume decorative motion' : 'Pause decorative motion');
    motionButton.innerHTML = paused ? 'RESUME MOTION <span aria-hidden="true">▶</span>' : 'PAUSE MOTION <span aria-hidden="true">Ⅱ</span>';
    const video = $('#hero-video'); if (!video.hidden) { if (paused) video.pause(); else video.play().catch(() => {}); }
  });
  $('#piece-dialog').addEventListener('close', event => event.currentTarget.querySelectorAll('iframe').forEach(frame => frame.remove()));
  const checkoutStatus = new URL(location.href).searchParams.get('checkout');
  if (checkoutStatus === 'success' || checkoutStatus === 'cancelled') {
    const note = $('#purchase-status'); note.hidden = false;
    note.textContent = checkoutStatus === 'success' ? 'Thank you. If your payment was successful, your PDF will be sent to the email used at checkout. If it does not arrive, please contact us.' : 'Checkout was cancelled. No payment was made in this checkout.';
    if (checkoutStatus === 'success') { try { const piece = new URL(location.href).searchParams.get('piece'); if (piece) sessionStorage.removeItem(`armonia-transcription-checkout/${piece}`); } catch {} }
    const clean = new URL(location.href); clean.searchParams.delete('checkout'); clean.searchParams.delete('piece'); history.replaceState(null,'',clean.pathname + clean.search + clean.hash);
  }
  $('#year').textContent = String(new Date().getFullYear());
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) { document.documentElement.classList.add('js-motion'); const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } }), {threshold:.12}); $$('.reveal').forEach(node => observer.observe(node)); }
  init();
})();
