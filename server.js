const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const DATA = path.join(__dirname, 'data');
const CANDIDATES = [path.join(DATA, 'pi.txt'), path.join(DATA, 'pi-1.txt')];   // full file first, 30M demo second
const FILE = path.resolve(process.env.PI_FILE || CANDIDATES.find((f) => fs.existsSync(f)) || CANDIDATES[0]);
const PUBLIC = path.join(__dirname, 'public');
const MAX_SLICE = 20000;     
const MAX_NEEDLE = 64;       
const CHUNK = 16 * 1024 * 1024;
const MAX_CONCURRENT_SEARCHES = 3;

let fh, OFF = 0, N = 0, active = 0;

async function init() {
  if (!fs.existsSync(FILE)) {
    console.error(`\n  Pi file not found: ${FILE}\n  Generate one:  python3 tools/gen-pi.py 30000000\n  (see README.md for the 1.5-2 billion digit version)\n`);
    process.exit(1);
  }
  fh = await fs.promises.open(FILE, 'r');
  const { size } = await fh.stat();
  const head = Buffer.alloc(64);
  await fh.read(head, 0, 64, 0);
  OFF = head[0] === 0x33 && head[1] === 0x2e ? 2 : 0;          
  const sample = head.subarray(OFF, 64).toString('latin1');
  if (!/^\d+$/.test(sample)) {
    console.error('  The pi file must contain only digits (no spaces / newlines). See README.md.');
    process.exit(1);
  }
  N = size - OFF;
}


async function scan(needle, from, end, align, ctl) {
  const nl = needle.length;
  const buf = Buffer.allocUnsafe(CHUNK + nl);
  let pos = from;
  while (pos < end) {
    if (ctl.aborted) return -2;
    const want = Math.min(CHUNK + nl - 1, end - pos);
    if (want < nl) break;
    const { bytesRead } = await fh.read(buf, 0, want, pos + OFF);
    if (bytesRead < nl) break;
    const view = buf.subarray(0, bytesRead);
    let i = 0;
    while ((i = view.indexOf(needle, i)) !== -1) {
      const abs = pos + i;
      if (align === 1 || (abs & 1) === 0) return abs;
      i++;
    }
    pos += CHUNK;
  }
  return -1;
}


const T = new Uint8Array(65536).fill(255);
for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) {
  const v = a * 10 + b;
  T[((48 + a) << 8) | (48 + b)] = ((v + 99) % 100) % 26;
}


async function scanWord(w, from, end, ctl) {
  const L = w.length, nl = 2 * L, w0 = w[0];
  const buf = Buffer.allocUnsafe(CHUNK + nl);
  let pos = from + (from & 1);                  
  while (pos < end) {
    if (ctl.aborted) return -2;
    const want = Math.min(CHUNK + nl - 2, end - pos);
    if (want < nl) break;
    const { bytesRead } = await fh.read(buf, 0, want, pos + OFF);
    if (bytesRead < nl) break;
    const last = bytesRead - nl;
    for (let i = 0; i <= last; i += 2) {
      if (T[(buf[i] << 8) | buf[i + 1]] !== w0) continue;
      let j = 1;
      while (j < L && T[(buf[i + 2 * j] << 8) | buf[i + 2 * j + 1]] === w[j]) j++;
      if (j === L) return pos + i;
    }
    pos += CHUNK;
  }
  return -1;
}

async function search(needle, from, align, wrap, ctl) {
  let idx = await scan(needle, from, N, align, ctl);
  if (idx === -1 && wrap && from > 0) {
    idx = await scan(needle, 0, Math.min(N, from + needle.length - 1), align, ctl);
  }
  return idx;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function api(req, res, u) {
  if (u.pathname === '/api/info') {
    return json(res, 200, { digits: N });
  }

  if (u.pathname === '/api/digits') {
    let start = Math.floor(Number(u.searchParams.get('start')));
    let len = Math.floor(Number(u.searchParams.get('len')));
    if (!(start >= 0) || !(len > 0)) return json(res, 400, { error: 'bad range' });
    len = Math.min(len, MAX_SLICE, Math.max(0, N - start));
    if (len <= 0) { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(''); }
    const buf = Buffer.allocUnsafe(len);
    await fh.read(buf, 0, len, start + OFF);
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=31536000, immutable' });
    return res.end(buf);
  }

  if (u.pathname === '/api/search') {
    const word = (u.searchParams.get('w') || '').toLowerCase();
    const q = u.searchParams.get('q') || '';
    if (word) { if (!/^[a-z]{1,32}$/.test(word)) return json(res, 400, { error: 'w must be 1-32 letters' }); }
    else if (!/^\d{1,64}$/.test(q) || q.length > MAX_NEEDLE) return json(res, 400, { error: 'q must be 1-64 digits' });
    const from = Math.max(0, Math.floor(Number(u.searchParams.get('from')) || 0));
    const align = u.searchParams.get('align') === '2' ? 2 : 1;
    const wrap = u.searchParams.get('wrap') === '1';
    if (active >= MAX_CONCURRENT_SEARCHES) return json(res, 503, { error: 'busy, try again' });

    const ctl = { aborted: false };
    res.on('close', () => { if (!res.writableEnded) ctl.aborted = true; });  
    active++;
    const t0 = process.hrtime.bigint();
    try {
      let idx, length;
      if (word) {
        const w = Array.from(word, (c) => c.charCodeAt(0) - 97);
        length = 2 * w.length;
        idx = await scanWord(w, from, N, ctl);
        if (idx === -1 && wrap && from > 0) idx = await scanWord(w, 0, Math.min(N, from + length - 1), ctl);
      } else {
        length = q.length;
        idx = await search(Buffer.from(q, 'latin1'), from, align, wrap, ctl);
      }
      if (idx === -2) return;
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      return json(res, 200, { found: idx >= 0, index: idx, length, total: N, ms: Math.round(ms) });
    } finally { active--; }
  }

  json(res, 404, { error: 'not found' });
}

function serveStatic(req, res, u) {
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  const full = path.join(PUBLIC, path.normalize(p));
  if (!full.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(full).pipe(res);
  });
}

init().then(() => {
  http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) {
      api(req, res, u).catch((e) => { console.error(e); if (!res.headersSent) json(res, 500, { error: 'server error' }); });
    } else serveStatic(req, res, u);
  }).listen(PORT, () => {
    console.log(`π search ready → http://localhost:${PORT}   (${N.toLocaleString('en-US')} digits from ${FILE})`);
  });
});
