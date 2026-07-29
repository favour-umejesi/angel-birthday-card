/**
 * Angel's shared birthday card server.
 * Zero dependencies: serves the card page and a tiny JSON API for wishes.
 *
 *   node server.js            → http://localhost:3000
 *
 * Env:
 *   PORT       — port to listen on (default 3000)
 *   DATA_DIR   — where wishes.json lives (default ./data)
 *   ADMIN_KEY  — if set, DELETE /api/wishes/:id works with header x-admin-key
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'wishes.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_KEY = process.env.ADMIN_KEY || '';

const LIMITS = { name: 40, location: 60, message: 1000 };
const MAX_BODY = 10 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

let wishes = [];
let saveChain = Promise.resolve();

function loadWishes() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (Array.isArray(parsed)) wishes = parsed;
    } else {
      fs.writeFileSync(DATA_FILE, '[]\n');
    }
  } catch (err) {
    console.error('Could not load wishes, starting empty:', err.message);
    wishes = [];
  }
}

function persist() {
  saveChain = saveChain.then(() =>
    fsp.writeFile(DATA_FILE, JSON.stringify(wishes, null, 2) + '\n').catch(err => {
      console.error('Failed to save wishes:', err.message);
    })
  );
  return saveChain;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function clientIp(req) {
  const fwd = req.headers['x-client-ip'] || req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// Light per-IP rate limit on posting: 5 wishes per minute.
const postLog = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (postLog.get(ip) || []).filter(t => now - t < 60_000);
  if (recent.length >= 5) {
    postLog.set(ip, recent);
    return true;
  }
  recent.push(now);
  postLog.set(ip, recent);
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function cleanField(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/wishes') {
    const sorted = [...wishes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sendJson(res, 200, { wishes: sorted });
  }

  if (req.method === 'POST' && url.pathname === '/api/wishes') {
    // Admin posts (used for seeding recovered wishes) skip the rate limit and
    // may carry their original id and timestamp.
    const isAdmin = Boolean(ADMIN_KEY) && req.headers['x-admin-key'] === ADMIN_KEY;
    if (!isAdmin && rateLimited(clientIp(req))) {
      return sendJson(res, 429, { error: 'That is a lot of wishes at once. Wait a minute and try again.' });
    }
    let data;
    try {
      data = JSON.parse(await readBody(req));
    } catch (err) {
      return sendJson(res, err.status || 400, { error: 'Could not read that wish. Please try again.' });
    }
    const name = cleanField(data.name, LIMITS.name);
    const location = cleanField(data.location, LIMITS.location);
    const message = typeof data.message === 'string'
      ? data.message.replace(/\r\n/g, '\n').replace(/[^\S\n]+/g, ' ').trim().slice(0, LIMITS.message)
      : '';

    if (!name) return sendJson(res, 400, { error: 'Add your name so Angel knows who this is from.' });
    if (!message) return sendJson(res, 400, { error: 'You forgot the wish part!' });

    const wish = {
      id: isAdmin && typeof data.id === 'string' && /^[a-z0-9-]{8,64}$/i.test(data.id)
        ? data.id
        : crypto.randomUUID(),
      name,
      location,
      message,
      createdAt: isAdmin && typeof data.createdAt === 'string' && !isNaN(Date.parse(data.createdAt))
        ? data.createdAt
        : new Date().toISOString()
    };
    if (!wishes.some(w => w.id === wish.id)) {
      wishes.push(wish);
      await persist();
    }
    return sendJson(res, 201, { wish });
  }

  if (req.method === 'DELETE' && url.pathname === '/api/wishes') {
    if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) {
      return sendJson(res, 403, { error: 'Not allowed.' });
    }
    const id = url.searchParams.get('id') || '';
    const before = wishes.length;
    wishes = wishes.filter(w => w.id !== id);
    if (wishes.length === before) return sendJson(res, 404, { error: 'No such wish.' });
    await persist();
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Not found.' });
}

function serveStatic(req, res, url) {
  let filePath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const resolved = path.resolve(PUBLIC_DIR, '.' + filePath);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== PUBLIC_DIR) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(resolved, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
}

loadWishes();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(err => {
      console.error('API error:', err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong on our side.' });
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`Angel's card is open at http://localhost:${PORT}`);
  console.log(`Wishes are saved to ${DATA_FILE}`);
});
