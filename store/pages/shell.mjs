/* Shared shell for the store's policy pages.
   Kept deliberately small: these are static pages (no React, no bundle) so
   they load instantly, work with JS disabled, and stay crawlable. The visual
   language (cream paper, ink type, gold rules, the four-point spark) matches
   the storefront. */

const STORE = 'https://www.armoniaconnect.com/store/';

const SPARK = `<svg viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><path d="M50 0C50 33 67 50 100 50C67 50 50 67 50 100C50 67 33 50 0 50C33 50 50 33 50 0Z"/></svg>`;

export function page({ title, description, eyebrow, heading, body, current = '' }) {
  const nav = [
    ['shipping', '/store/shipping', 'Shipping & returns'],
    ['care', '/store/care', 'Product care'],
    ['contact', '/store/contact', 'Contact'],
  ]
    .map(
      ([key, href, label]) =>
        `<a href="${href}"${key === current ? ' aria-current="page"' : ''}>${label}</a>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Armonia Connect</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="#142529">
<link rel="canonical" href="${STORE}${current}">
<meta property="og:title" content="${title} — Armonia Connect">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<link rel="icon" type="image/png" href="/store/images/favicon-store.png">
<style>
  @font-face{font-family:Manrope;font-style:normal;font-weight:400;font-display:swap;src:url(/store/fonts/Manrope-400.ttf) format("truetype")}
  @font-face{font-family:Manrope;font-style:normal;font-weight:500;font-display:swap;src:url(/store/fonts/Manrope-500.ttf) format("truetype")}
  @font-face{font-family:Manrope;font-style:normal;font-weight:600;font-display:swap;src:url(/store/fonts/Manrope-600.ttf) format("truetype")}
  @font-face{font-family:Manrope;font-style:normal;font-weight:700;font-display:swap;src:url(/store/fonts/Manrope-700.ttf) format("truetype")}
  :root{--ink:#142529;--cream:#f6f3eb;--paper:#eee9de;--gold:#e5be73;--muted:#5d6b60;--line:#1425291a}
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;background:var(--cream);color:var(--ink);font-family:Manrope,system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.7;-webkit-font-smoothing:antialiased}
  a{color:inherit}
  .wrap{max-width:760px;margin:0 auto;padding:0 26px}
  header.site{background:var(--ink);color:var(--cream);padding:18px 0}
  header.site .wrap{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
  .brand{display:flex;align-items:center;gap:12px;text-decoration:none}
  .brand svg{width:17px;height:27px;color:var(--gold)}
  .brand span{letter-spacing:.42em;font-size:12px;font-weight:600;text-transform:uppercase}
  nav.pages{display:flex;gap:22px;font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;flex-wrap:wrap}
  nav.pages a{text-decoration:none;opacity:.72;border-bottom:1px solid transparent;padding-bottom:2px}
  nav.pages a:hover{opacity:1}
  nav.pages a[aria-current]{opacity:1;border-bottom-color:var(--gold)}
  main{padding:64px 0 72px}
  .eyebrow{font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;color:#8a9384;margin:0 0 18px}
  h1{font-size:clamp(32px,5vw,48px);line-height:1.1;letter-spacing:-.02em;font-weight:500;margin:0 0 26px}
  h2{font-size:19px;font-weight:600;letter-spacing:-.01em;margin:38px 0 10px}
  h3{font-size:15px;font-weight:600;margin:26px 0 8px}
  p{margin:0 0 16px;color:#3d4b44}
  ul{margin:0 0 18px;padding-left:20px}
  li{margin-bottom:8px;color:#3d4b44}
  a.link{color:var(--ink);text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
  .rule{display:flex;align-items:center;gap:14px;margin:34px 0;color:var(--gold)}
  .rule svg{width:13px;height:13px;flex-shrink:0}
  .rule i{flex:1;height:1px;background:var(--line)}
  .card{background:#fff;border:1px solid var(--line);padding:26px 28px;margin:0 0 20px}
  .card h2{margin-top:0}
  .cta{display:inline-flex;align-items:center;gap:10px;background:var(--ink);color:var(--cream);text-decoration:none;padding:14px 26px;font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;transition:background .2s}
  .cta:hover{background:#0d1a1d}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:20px;margin:26px 0 6px}
  .grid .card{margin:0}
  form{display:flex;flex-direction:column;gap:16px;max-width:520px}
  label{display:flex;flex-direction:column;gap:7px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6b776c;font-weight:600}
  input,textarea,select{font:inherit;font-size:15px;letter-spacing:0;text-transform:none;color:var(--ink);background:#fff;border:1px solid var(--line);padding:12px 14px;border-radius:0;width:100%}
  textarea{min-height:130px;resize:vertical}
  input:focus,textarea:focus{outline:2px solid var(--gold);outline-offset:-1px}
  button.cta{border:0;cursor:pointer;font-family:inherit}
  .note{font-size:13px;color:#7c877b;margin-top:4px}
  .status{margin-top:14px;font-size:14px}
  .status.ok{color:#2f6b3d}
  .status.err{color:#8c2d0b}
  footer.site{border-top:1px solid var(--line);padding:30px 0 46px;font-size:12px;color:#7c877b}
  footer.site .wrap{display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap;align-items:center}
  footer.site a{text-decoration:none;border-bottom:1px solid transparent}
  footer.site a:hover{border-bottom-color:currentColor}
  @media(max-width:600px){
    main{padding:42px 0 56px}
    nav.pages{gap:16px;font-size:10.5px}
    h1{margin-bottom:20px}
    .card{padding:20px}
  }
</style>
</head>
<body>
<header class="site">
  <div class="wrap">
    <a class="brand" href="/store/">${SPARK}<span>Armonia</span></a>
    <nav class="pages" aria-label="Store information">${nav}<a href="/store/">The collection ↗</a></nav>
  </div>
</header>
<main>
  <div class="wrap">
    ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}
    <h1>${heading}</h1>
    ${body}
  </div>
</main>
<footer class="site">
  <div class="wrap">
    <span>© ${new Date().getFullYear()} Armonia Connect · Good things. Better together.</span>
    <span><a href="/terms.html">Terms</a> · <a href="/privacy.html">Privacy</a> · <a href="/store/shipping#returns">Returns</a></span>
  </div>
</footer>
${current === 'contact' ? CONTACT_SCRIPT : ''}
</body>
</html>`;
}

/* The contact form posts to the same endpoint the store modal uses. */
const CONTACT_SCRIPT = `<script>
(function () {
  var form = document.querySelector('form[data-contact]');
  if (!form) return;
  var status = document.querySelector('[data-status]');
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = form.querySelector('button[type=submit]');
    var data = Object.fromEntries(new FormData(form));
    button.disabled = true;
    button.textContent = 'Sending…';
    status.className = 'status';
    status.textContent = '';
    try {
      var res = await fetch('/api/store/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      var payload = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(payload.error || 'Something went wrong.');
      form.reset();
      status.className = 'status ok';
      status.textContent = 'Message received — thank you. We reply within one business day.';
    } catch (err) {
      status.className = 'status err';
      status.textContent = err.message + ' You can also email maestro.armoniaconnect@gmail.com.';
    } finally {
      button.disabled = false;
      button.textContent = 'Send message';
    }
  });
})();
</script>`;
