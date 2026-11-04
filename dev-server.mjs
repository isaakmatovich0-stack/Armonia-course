#!/usr/bin/env node
/**
 * Local dev server — `npm run dev` → http://localhost:3000
 * ---------------------------------------------------------------------------
 * Vercel isn't available in every sandbox, so this is a small development
 * stand-in that reproduces the parts of the platform the project relies on:
 *
 *   • static files from public/            (/store/, /course/, /privacy.html …)
 *   • API routes from api/                 (/api/store/bag, /api/redeem, …)
 *     using the same catch-all mapping Vercel applies, via a light shim for
 *     the `req.body` / `res.status().json()` helpers the handlers expect
 *   • .env loaded from .env.local / .env   (nothing is read from the client)
 *
 * It is a development tool only: single process, no caching, no TLS. The real
 * deployment is plain Vercel serverless functions.
 *
 *   node dev-server.mjs [port]
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 3000);

/* ── .env loading (minimal, no dependency) ─────────────────────────────── */
for (const name of ['.env.local', '.env']) {
  const file = path.join(ROOT, name);
  if (!fs.existsSync(file)) continue;
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line) => {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!match) return;
      const key = match[1];
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    });
}

// Local store data lives in .tmp/store-db.json unless a Supabase project is
// configured for this machine. api/store/[...slug].js reads STORE_LOCAL_DB via lib/store/db.js.
if (process.env.STORE_LOCAL_DB === undefined && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.env.STORE_LOCAL_DB = '1';
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/* ── API routing: mirror Vercel's file-based rules ─────────────────────── */
function apiModuleFor(segments) {
  // Mirrors Vercel's precedence: an exact file wins, then the longest
  // directory catch-all (/api/store/bag → api/store/[...slug].js → api/[...slug].js).
  const candidates = [];
  for (let length = segments.length; length >= 1; length -= 1) {
    const slice = segments.slice(0, length);
    candidates.push(path.join(ROOT, 'api', ...slice.slice(0, -1), `${slice[slice.length - 1]}.js`));
  }
  for (let length = segments.length - 1; length >= 0; length -= 1) {
    const base = segments.slice(0, length);
    candidates.push(path.join(ROOT, 'api', ...base, '[...slug].js'));
  }
  return candidates.find((file) => fs.existsSync(file)) || null;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function makeResponse(res) {
  const shim = {
    statusCode: 200,
    setHeader: (key, value) => res.setHeader(key, value),
    getHeader: (key) => res.getHeader(key),
    status(code) {
      shim.statusCode = code;
      res.statusCode = code;
      return shim;
    },
    json(payload) {
      if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.statusCode = shim.statusCode;
      res.end(JSON.stringify(payload));
      return shim;
    },
    send(payload) {
      res.statusCode = shim.statusCode;
      if (typeof payload === 'string') {
        if (!res.headersSent) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(payload);
      } else {
        res.end(payload);
      }
      return shim;
    },
    end(payload) {
      res.statusCode = shim.statusCode;
      res.end(payload);
      return shim;
    },
    redirect(location) {
      res.statusCode = 302;
      res.setHeader('Location', location);
      res.end();
      return shim;
    },
  };
  return shim;
}

const handlers = new Map(); // module path → imported handler

async function handleApi(req, res, pathname) {
  const segments = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const file = apiModuleFor(segments);
  if (!file) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: `No API route for /api/${segments.join('/')}` }));
    return;
  }

  // Routes that opt out of body parsing (the Stripe webhook) need the exact
  // bytes. Vercel hands those handlers the raw stream; here we buffer it and
  // hand over the Buffer — signature verification hashes the untouched bytes,
  // and the handlers' own jsonBody() helper still parses JSON when it needs to.
  let mod = handlers.get(file);
  if (!mod) {
    mod = await import(pathToFileURL(file).href);
    handlers.set(file, mod);
  }
  const wantsRawBody = Boolean(mod.config && mod.config.api && mod.config.api.bodyParser === false);

  const raw = await readBody(req);
  const contentType = String(req.headers['content-type'] || '');
  const shimReq = Object.assign(req, {
    url: pathname + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''),
    query: Object.fromEntries(new URL(req.url, `http://localhost:${PORT}`).searchParams),
    body: wantsRawBody
      ? raw
      : raw.length
      ? contentType.includes('application/json')
        ? (() => {
            try {
              return JSON.parse(raw.toString('utf8'));
            } catch {
              return {};
            }
          })()
        : raw
      : {},
  });

  if (typeof mod.default !== 'function') {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Route has no default export.' }));
    return;
  }

  try {
    await mod.default(shimReq, makeResponse(res));
  } catch (err) {
    console.error(`[dev] ${req.method} ${pathname} failed:`, err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message || 'Server error' }));
    }
  }
}

/* ── static files ─────────────────────────────────────────────────────── */
function serveStatic(req, res, pathname) {
  let relative = decodeURIComponent(pathname);
  if (relative.endsWith('/')) relative += 'index.html';

  let file = path.join(ROOT, 'public', relative);
  if (!file.startsWith(path.join(ROOT, 'public'))) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }

  // Pretty routes: /store/shipping → public/store/shipping.html, /terms → public/terms.html
  const extras = [file, `${file}.html`, path.join(file, 'index.html')];
  file = extras.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!file) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end('<h1>404</h1><p>Not found in public/.</p>');
  }

  const ext = path.extname(file).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  // Match production caching closely enough to catch stale-asset bugs.
  if (file.includes(`${path.sep}fonts${path.sep}`) || file.includes(`${path.sep}images${path.sep}`)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'no-cache');
  }
  if (ext === '.mjs' || ext === '.js') res.setHeader('Access-Control-Allow-Origin', '*');
  fs.createReadStream(file).pipe(res);
}

/* ── server ───────────────────────────────────────────────────────────── */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Preview hosts (e.g. *.e2b.app) and any origin: dev only, allow all.
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Stripe-Signature, X-Cart-Id');
  res.setHeader('Access-Control-Expose-Headers', 'X-Cart-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch((err) => {
      console.error('[dev] api error', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Server error' }));
      }
    });
    return;
  }

  // Root → whatever this project treats as home (the course flyer page).
  if (pathname === '/') return serveStatic(req, res, '/index.html');
  if (pathname === '/store') {
    res.statusCode = 301;
    res.setHeader('Location', '/store/');
    return res.end();
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Armonia dev server → http://0.0.0.0:${PORT}`);
  console.log('  store        /store/');
  console.log('  course       /course/');
  console.log(`  stripe key   ${process.env.STRIPE_SECRET_KEY ? 'present — checkout live' : 'missing — store runs in browse-only mode'}`);
  console.log(`  store db     ${process.env.STORE_LOCAL_DB === '1' ? 'local file (.tmp/store-db.json)' : 'Supabase'}`);
});
