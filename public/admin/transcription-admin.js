(() => {
  'use strict';
  const root = document.getElementById('transcriptionAdmin');
  let api, config, revision, loaded = false, dirty = false, busy = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const images = [
    ['brandLogo','Suite logo','/store/images/brand-logo.webp'], ['favicon','Browser icon','/store/images/favicon-store.png'],
    ['heroBackgroundImage','Hero background','/transcription/images/stage-lights.jpg'], ['heroArtImage','Hero record artwork','/transcription/images/studio-editorial.jpg'],
    ['screeningBackgroundImage','Screening room background','/transcription/images/stage-lights.jpg'], ['featuredImage','Featured piece image','/transcription/images/studio-editorial.jpg'],
    ['insideImage','Closer Look background','/transcription/images/studio-editorial.jpg'], ['newsImage','Performance journal image','/isaak-portrait.jpg'],
    ['defaultCover','Default product cover','/transcription/images/studio-editorial.jpg']
  ];
  function field(label, group, index, key, value, opts = {}) {
    const path = `data-group="${group}" data-index="${index}" data-key="${key}"`;
    const attrs = `${path} ${opts.required ? 'required' : ''} maxlength="${opts.max || (opts.long ? 3000 : 2048)}"`;
    const control = opts.long ? `<textarea ${attrs}>${esc(value)}</textarea>` : `<input type="${opts.type || 'text'}" ${attrs} value="${esc(value)}" ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''}>`;
    const preview = opts.image ? `<img class="ts-preview" src="${esc(value || opts.defaultImage)}" alt="${esc(label)} preview"><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-upload-group="${group}" data-upload-index="${index}" data-upload-key="${key}" aria-label="Upload ${esc(label)}"><small>Choose a JPG, PNG, GIF or WEBP up to 3 MB, or paste a public HTTPS/image path above. Uploads are public.</small>` : '';
    return `<label class="ts-field ${opts.span ? 'ts-span' : ''}">${esc(label)}${control}${preview}${opts.help ? `<small>${esc(opts.help)}</small>` : ''}</label>`;
  }
  function get(group, index) { return group === 'media' ? config.media : group === 'pieces' ? config.pieces[Number(index)] : config.news[Number(index)]; }
  function status(message, error = false) { const node = root.querySelector('.ts-status'); if (node) { node.textContent = message; node.classList.toggle('error', error); } }
  function markDirty() { dirty = true; status('Unsaved changes. Select Save all changes to publish.'); }
  function render() {
    const mediaInputs = images.map(([key, label, fallback]) => field(label, 'media', 0, key, config.media[key] || '', {image:true,defaultImage:fallback,placeholder:'Using the default image'})).join('');
    const cards = config.pieces.map((piece, i) => `<details class="ts-card"><summary><strong>${esc(piece.title || 'Untitled piece')}</strong><span>${piece.sample ? 'EXAMPLE' : 'REAL PIECE'} · ${esc(piece.instrument || 'No instrument')}</span></summary><div class="ts-card-body"><div class="ts-grid">
      ${field('Title *','pieces',i,'title',piece.title,{required:true,max:200})}
      ${field('Artist / origin','pieces',i,'artist',piece.artist)}
      ${field('Instrument / category','pieces',i,'instrument',piece.instrument,{placeholder:'e.g. Vihuela, Ensemble'})}
      ${field('Display price','pieces',i,'priceLabel',piece.priceLabel,{placeholder:'e.g. $12.00',help:'Display only. This does not create a payment or download.'})}
      ${field('Description / story','pieces',i,'description',piece.description,{long:true,span:true})}
      ${field('Cover artwork','pieces',i,'cover',piece.cover,{image:true,defaultImage:config.media.defaultCover || '/transcription/images/studio-editorial.jpg'})}
      ${field('Score preview image','pieces',i,'scorePreviewImage',piece.scorePreviewImage,{image:true,defaultImage:'/transcription/images/studio-editorial.jpg',help:'Optional public excerpt only — never upload a private paid score.'})}
      ${field('Music preview URL','pieces',i,'previewUrl',piece.previewUrl,{help:'Public score or audio preview link.'})}
      ${field('YouTube performance URL or ID','pieces',i,'youtubeUrl',piece.youtubeUrl)}
      ${field('Checkout URL','pieces',i,'checkoutUrl',piece.checkoutUrl,{help:'Optional HTTPS link to an already configured and tested external checkout.'})}
      ${field('Level','pieces',i,'level',piece.level)}${field('Key','pieces',i,'key',piece.key)}${field('Duration','pieces',i,'duration',piece.duration)}${field('Parts','pieces',i,'parts',piece.parts)}
      <label class="ts-field ts-span"><input type="checkbox" data-group="pieces" data-index="${i}" data-key="sample" ${piece.sample ? 'checked' : ''}>Mark as example (no purchase or real preview shown)</label>
      </div><div class="ts-actions ts-card-actions"><button type="button" class="ts-button" data-action="up-piece" data-index="${i}">↑ Move up</button><button type="button" class="ts-button" data-action="down-piece" data-index="${i}">↓ Move down</button><button type="button" class="ts-button danger" data-action="delete-piece" data-index="${i}">Remove piece</button></div></div></details>`).join('');
    const news = config.news.map((item,i) => `<details class="ts-card"><summary><strong>${esc(item.title || 'Untitled performance')}</strong><span>VIDEO</span></summary><div class="ts-card-body"><div class="ts-grid">${field('Title *','news',i,'title',item.title,{required:true,max:200})}${field('Group or label','news',i,'label',item.label,{max:200})}${field('Video URL *','news',i,'url',item.url,{required:true,span:true,help:'HTTPS link; YouTube videos play inline.'})}</div><div class="ts-card-actions"><button type="button" class="ts-button danger" data-action="delete-news" data-index="${i}">Remove video</button></div></div></details>`).join('');
    const featuredOptions = `<option value="">First piece in collection</option>` + config.pieces.map(p => `<option value="${esc(p.id)}" ${config.featuredId === p.id ? 'selected' : ''}>${esc(p.title || 'Untitled piece')}</option>`).join('');
    root.innerHTML = `<div class="ts-header"><div><h2>Transcription Suite</h2><p>Manage the collection, images, and videos. Changes publish together when you save.</p><p>The suite is temporarily hidden from the live site for the store drop. Your saved content remains here for its later release.</p></div><div class="ts-actions"><button type="button" class="ts-button" data-action="manage-sales">Manage PDF sales</button><button type="button" class="ts-button" data-action="reload">Reload saved content</button><button type="button" class="ts-button primary" data-action="save">Save all changes</button></div></div><p class="ts-status" role="status">${dirty ? 'Unsaved changes. Select Save all changes to publish.' : 'Changes appear on the suite after saving.'}</p><fieldset class="ts-disabled"><div class="ts-warning">Examples are labeled and are not for sale. Prices are display-only; checkout and digital delivery must be configured separately. Upload only content you have permission to share.</div>
      <details class="ts-group" open><summary><strong>Transcription products (${config.pieces.length})</strong></summary><div class="ts-group-body"><p class="ts-help">Expand a piece to edit it. Add, remove, or reorder pieces. Changes are not published until you save.</p><label class="ts-field" style="margin-top:14px">Featured composition<select data-featured><option value="">First piece in collection</option>${featuredOptions.replace('<option value="">First piece in collection</option>','')}</select></label><div class="ts-cards">${cards || '<p class="ts-empty">No pieces yet. Add one to get started.</p>'}</div><div class="ts-actions" style="margin-top:16px"><button type="button" class="ts-button primary" data-action="add-piece">+ Add transcription</button></div></div></details>
      <details class="ts-group"><summary><strong>Suite images &amp; branding</strong></summary><div class="ts-group-body"><p class="ts-help">Replace every suite image using an upload or URL. Leave a field blank to use its current default. Product artwork is edited on each product.</p><div class="ts-grid" style="margin-top:16px">${mediaInputs}</div></div></details>
      <details class="ts-group"><summary><strong>Screening room &amp; background video</strong></summary><div class="ts-group-body"><div class="ts-grid">${field('Featured YouTube URL or ID','media',0,'screeningYoutubeUrl',config.media.screeningYoutubeUrl,{help:'The player loads when a visitor presses play.'})}${field('Video title','media',0,'screeningTitle',config.media.screeningTitle)}${field('Video description','media',0,'screeningDescription',config.media.screeningDescription,{long:true,span:true})}${field('Hero background video file URL','media',0,'heroBackgroundVideo',config.media.heroBackgroundVideo,{span:true,help:'Direct HTTPS or site-relative MP4 URL, not a YouTube page. Muted and looping; image is used as fallback.'})}</div></div></details>
      <details class="ts-group"><summary><strong>Performance journal (${config.news.length})</strong></summary><div class="ts-group-body"><p class="ts-help">Add videos of groups performing your arrangements.</p><div class="ts-cards">${news || '<p class="ts-empty">No videos added yet.</p>'}</div><div class="ts-actions" style="margin-top:16px"><button type="button" class="ts-button primary" data-action="add-news">+ Add performance</button></div></div></details></fieldset><div class="ts-actions"><button type="button" class="ts-button primary" data-action="save">Save all changes</button></div>`;
  }
  async function load(force = false) {
    if (busy) return;
    if (loaded && !force) return;
    busy = true;
    try {
      const data = await api('/api/admin/transcription-content');
      let content = data.config;
      if (!content) { const response = await fetch('/transcription/catalog.json', {cache:'no-store'}); if (!response.ok) throw new Error('Could not load the starter collection.'); content = await response.json(); }
      config = content; config.media ||= {}; config.news ||= []; config.pieces ||= []; config.featuredId ||= ''; revision = data.revision; dirty = false; loaded = true; render();
    } catch (error) { root.innerHTML = `<p class="ts-status error" role="alert">${esc(error.message)}</p><button type="button" class="ts-button" data-action="retry">Try again</button>`; loaded = false; }
    finally { busy = false; }
  }
  function lock(value) { busy = value; root.querySelectorAll('button, input, textarea, select').forEach(node => { node.disabled = value; }); }
  async function save() {
    if (!loaded || busy) return;
    if (config.pieces.some(piece => !piece.title.trim())) { status('Each piece needs a title before saving.', true); return; }
    if (config.news.some(item => !item.title.trim() || !item.url.trim())) { status('Each performance needs a title and video URL before saving.', true); return; }
    lock(true); status('Saving suite content…');
    try { const result = await api('/api/admin/transcription-content', {method:'PUT', body:JSON.stringify({ config, revision })}); revision = result.revision; dirty = false; status('Saved. Your changes are now published to the suite.'); }
    catch (error) { status(error.message, true); }
    finally { lock(false); }
  }
  root.addEventListener('input', event => {
    const node = event.target;
    if (node.matches('[data-group]')) { const target = get(node.dataset.group, node.dataset.index); if (!target) return; target[node.dataset.key] = node.type === 'checkbox' ? node.checked : node.value; markDirty(); }
    if (node.matches('[data-featured]')) { config.featuredId = node.value; markDirty(); }
  });
  root.addEventListener('change', async event => {
    const input = event.target; if (!input.matches('[data-upload-group]') || !input.files.length || busy) return;
    const file = input.files[0]; if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || file.size > 3 * 1024 * 1024) { status('Choose a JPG, PNG, GIF or WEBP image under 3 MB.', true); input.value = ''; return; }
    const target = get(input.dataset.uploadGroup, input.dataset.uploadIndex); const key = input.dataset.uploadKey; const label = input.closest('.ts-field');
    lock(true); status('Uploading image…');
    try {
      const imageBase64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read image.')); reader.readAsDataURL(file); });
      const result = await api('/api/admin/upload-image', {method:'POST', body:JSON.stringify({imageBase64,contentType:file.type})});
      target[key] = result.url; label.querySelector(`[data-key="${key}"]`).value = result.url; label.querySelector('.ts-preview').src = result.url; markDirty(); status('Image uploaded. Save all changes to publish it.');
    } catch (error) { status(error.message, true); }
    finally { input.value = ''; lock(false); }
  });
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-action]'); if (!button || busy) return; const action = button.dataset.action, i = Number(button.dataset.index);
    if (action === 'retry') { load(true); return; }
    if (action === 'manage-sales') { if (dirty && !confirm('Sales settings use the last saved collection. Continue without saving your edits?')) return; window.transcriptionSalesAdmin.open(api); return; }
    if (action === 'save') { save(); return; }
    if (action === 'reload') { if (dirty && !confirm('Discard unsaved changes and reload?')) return; load(true); return; }
    if (action === 'add-piece') { config.pieces.push({id:'piece-' + (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`),title:'',artist:'',instrument:'',description:'',cover:'',previewUrl:'',checkoutUrl:'',priceLabel:'',sample:false}); markDirty(); render(); root.querySelector('.ts-cards .ts-card:last-child')?.setAttribute('open',''); return; }
    if (action === 'delete-piece') { if (!confirm(`Remove “${config.pieces[i].title || 'Untitled piece'}” from the suite? Save to publish this change.`)) return; const removed = config.pieces.splice(i,1)[0]; if (config.featuredId === removed.id) config.featuredId = ''; markDirty(); render(); return; }
    if (action === 'up-piece' || action === 'down-piece') { const j = i + (action === 'up-piece' ? -1 : 1); if (j < 0 || j >= config.pieces.length) return; [config.pieces[i],config.pieces[j]] = [config.pieces[j],config.pieces[i]]; markDirty(); render(); return; }
    if (action === 'add-news') { config.news.push({title:'',label:'',url:''}); markDirty(); render(); const group = root.querySelectorAll('.ts-group')[3]; group.open = true; group.querySelector('.ts-card:last-child')?.setAttribute('open',''); return; }
    if (action === 'delete-news') { if (!confirm('Remove this performance? Save to publish this change.')) return; config.news.splice(i,1); markDirty(); render(); root.querySelectorAll('.ts-group')[3].open = true; }
  });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  window.transcriptionAdmin = { open: fetcher => { api = fetcher; load(); } };
})();
