(() => {
'use strict';

const BLOCK = 2048;           
const MIN_SEARCH_MS = 1100;    
const FAM = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
const MAX_DIGITS = 32;         

const $ = (s) => document.querySelector(s);
const el = {
  canvas: $('#grid'), form: $('#bar'), q: $('#q'), status: $('#status'), modeBtn: $('#modeBtn'),
  next: $('#nextBtn'), go: $('#goBtn'), total: $('#total'), range: $('#range'),
  rail: $('#rail'), thumb: $('#thumb'), goto: $('#goto'), mute: $('#mute'),
  waves: $('#waves'), slash: $('#slash'),
};
const ctx = el.canvas.getContext('2d', { alpha: false });
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};


const S = {
  N: 0, mode: 'digits', fs: Number(store.get('pi-fs')) || (innerWidth < 600 ? 22 : 28),
  top: 0, vel: 0, anim: null,
  match: null,           
  last: null,            
  searching: false, pulseT0: -1e9,
};
let W = 0, H = 0, dpr = 1, cellW = 20, cellH = 40, cols = 10, dpc = 1, digitsPerRow = 10, rowsVis = 20, originX = 0, gutter = 0;


const TOP_PAD = 74;                                  
function minTop() { return -TOP_PAD / cellH; }
function maxTop() { return Math.max(0, Math.ceil(S.N / digitsPerRow) - 3); }
function clampTop(v) { return Math.min(Math.max(minTop(), v), maxTop()); }

function layout() {
  const anchorDigit = S.top * digitsPerRow;             
  W = innerWidth; H = innerHeight; dpr = Math.min(window.devicePixelRatio || 1, 3);
  el.canvas.width = Math.round(W * dpr); el.canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const fs = S.fs;
  ctx.font = `400 ${fs}px ${FAM}`;
  const dW = Math.round(ctx.measureText('0').width * 1.38);       

  cellH = Math.round(fs * 1.85);
  dpc = S.mode === 'letters' ? 2 : 1;
  cellW = S.mode === 'letters' ? Math.round(dW * 1.55) : dW;
  gutter = W > 760 ? 128 : Math.round(dW * 1.9);
  const avail = W - gutter - 34;
  cols = Math.max(3, Math.floor(avail / cellW));
  digitsPerRow = cols * dpc;
  originX = gutter + (avail - cols * cellW) / 2 + cellW / 2;
  rowsVis = Math.ceil(H / cellH) + 1;
  S.top = clampTop(anchorDigit / digitsPerRow);
  dirty();
}


const blocks = new Map();     
const pending = new Map();    

function ensure(first, last) {
  const b0 = Math.max(0, Math.floor(first / BLOCK));
  const b1 = Math.floor(Math.max(0, Math.min(last, S.N - 1)) / BLOCK);
  const order = [];
  for (let i = b0; i <= b1; i++) order.push(i);
  order.push(b0 - 1, b1 + 1, b1 + 2);
  const want = new Set(order.filter((i) => i >= 0 && i * BLOCK < S.N));
  for (let i = b0; i <= b1; i++) { const v = blocks.get(i); if (v !== undefined) { blocks.delete(i); blocks.set(i, v); } } // LRU touch
  for (const [i, ac] of pending) if (!want.has(i)) { ac.abort(); pending.delete(i); }
  for (const i of want) {
    if (blocks.has(i) || pending.has(i)) continue;
    if (pending.size >= 8) break;
    fetchBlock(i);
  }
}

function fetchBlock(i) {
  const ac = new AbortController();
  pending.set(i, ac);
  fetch(`/api/digits?start=${i * BLOCK}&len=${BLOCK}`, { signal: ac.signal })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error('bad'))))
    .then((t) => {
      pending.delete(i); blocks.set(i, t);
      if (blocks.size > 600) blocks.delete(blocks.keys().next().value);
      dirty();
    })
    .catch((e) => { if (pending.get(i) === ac) pending.delete(i); if (e.name !== 'AbortError') setTimeout(dirty, 1500); });
}

function slice(start, len) {
  let out = '', p = start;
  const end = Math.min(start + len, S.N);
  while (p < end) {
    const bi = Math.floor(p / BLOCK), off = p - bi * BLOCK, take = Math.min(BLOCK - off, end - p);
    const b = blocks.get(bi);
    let part = b !== undefined ? b.substr(off, take) : '';
    if (part.length < take) part += ' '.repeat(take - part.length);   
    out += part; p += take;
  }
  return out;
}


let raf = 0, lastT = 0;
function dirty() { if (!raf) raf = requestAnimationFrame(frame); }

function frame(now) {
  raf = 0;
  const dt = Math.min(50, now - (lastT || now));
  let again = false;

  if (S.anim) {
    const a = S.anim, k = Math.min(1, (now - a.t0) / a.dur), e = 1 - Math.pow(1 - k, 3);
    S.top = a.from + (a.to - a.from) * e;
    if (k >= 1) S.anim = null; else again = true;
  }
  if (S.vel) {
    const before = S.top;
    S.top = clampTop(S.top + S.vel * dt);
    if (S.top === before) S.vel = 0;
    S.vel *= Math.exp(-dt / 320);
    if (Math.abs(S.vel) < 0.0004) S.vel = 0; else again = true;
  }

  draw(now);
  updateHud();
  if (S.searching || now - S.pulseT0 < 2500) again = true;
  lastT = again ? now : 0;
  if (again) dirty();
}

function draw(now) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const r0 = Math.floor(S.top), off = (S.top - r0) * cellH;
  ensure(r0 * digitsPerRow, (r0 + rowsVis) * digitsPerRow);

  const letters = S.mode === 'letters';
  const m = S.match;
  const fs = S.fs;
  const scanY = S.searching ? ((now / 1100) % 1) * (H + 240) - 120 : -9999;
  const pulse = now - S.pulseT0 < 2500 ? 0.5 + 0.5 * Math.sin(now / 170) : 0;
  const hits = [], flick = [];

  ctx.textBaseline = 'middle';
  for (let r = 0; r < rowsVis; r++) {
    const row = r0 + r, base = row * digitsPerRow;
    if (row < 0) continue;
    if (base >= S.N) break;
    const y = r * cellH - off + cellH / 2;
    const str = slice(base, digitsPerRow);

    ctx.textAlign = 'right';
    if (row === 0) {
      ctx.font = `700 ${fs}px ${FAM}`; ctx.fillStyle = '#fff';
      ctx.fillText('3.', originX - cellW / 2 - 4, y);
    } else if (W > 760) {
      ctx.font = `400 11px ${FAM}`; ctx.fillStyle = '#505050';
      ctx.fillText(fmt(base / dpc + 1), gutter - 14, y);
    }

    ctx.textAlign = 'center';
    ctx.font = `400 ${fs}px ${FAM}`;
    ctx.fillStyle = '#ececec';
    const inBand = Math.abs(y - scanY) < cellH * 1.3;
    for (let c = 0; c < cols; c++) {
      const d = base + c * dpc;
      if (d >= S.N) break;
      const x = originX + c * cellW;
      let ch;
      if (!letters) {
        ch = str[c];
      } else {
        const a = str.charCodeAt(c * 2) - 48, b = str.charCodeAt(c * 2 + 1) - 48;
        if (!(a >= 0 && a <= 9 && b >= 0 && b <= 9)) ch = ' ';
        else { const v = a * 10 + b; ch = String.fromCharCode(65 + ((v + 99) % 100) % 26); }   // repeating alphabet, 00 = 100
      }
      if (m && d < m.e && d + dpc > m.s) { hits.push(x, y, ch); continue; }
      if (S.searching && (inBand || Math.random() < 0.012)) {
        flick.push(x, y, letters ? String.fromCharCode(65 + ((Math.random() * 26) | 0)) : String((Math.random() * 10) | 0), inBand);
        continue;
      }
      if (ch === ' ') { ctx.fillStyle = '#1c1c1c'; ctx.fillText('·', x, y); ctx.fillStyle = '#ececec'; continue; }
      if (ch === '·') { ctx.fillStyle = '#3a3a3a'; ctx.fillText(ch, x, y); ctx.fillStyle = '#ececec'; continue; }
      ctx.fillText(ch, x, y);
    }
  }


  if (S.searching) {
    ctx.fillStyle = '#ffb830';
    for (let i = 0; i < flick.length; i += 4) {
      ctx.globalAlpha = flick[i + 3] ? 0.95 : 0.35;
      ctx.fillText(flick[i + 2], flick[i], flick[i + 1]);
    }
    ctx.globalAlpha = 1;
    const g = ctx.createLinearGradient(0, scanY - 60, 0, scanY + 2);
    g.addColorStop(0, 'rgba(255,214,10,0)'); g.addColorStop(1, 'rgba(255,214,10,.16)');
    ctx.fillStyle = g; ctx.fillRect(0, scanY - 60, W, 62);
    ctx.fillStyle = 'rgba(255,214,10,.7)'; ctx.fillRect(0, scanY, W, 1);
  }


  if (hits.length) {
    ctx.fillStyle = 'rgba(255,214,10,.13)';
    for (let i = 0; i < hits.length; i += 3) ctx.fillRect(hits[i] - cellW / 2, hits[i + 1] - cellH / 2 + 3, cellW, cellH - 6);
    ctx.font = `700 ${fs}px ${FAM}`;
    ctx.fillStyle = '#ffd60a';
    ctx.shadowColor = 'rgba(255,214,10,.95)';
    ctx.shadowBlur = 10 + pulse * 16;
    for (let i = 0; i < hits.length; i += 3) ctx.fillText(hits[i + 2] === ' ' ? '·' : hits[i + 2], hits[i], hits[i + 1]);
    ctx.shadowBlur = 0;
  }
}

function updateHud() {
  const r0 = Math.floor(S.top);
  const a = Math.max(0, Math.floor((r0 * digitsPerRow) / dpc)) + 1;
  const b = Math.min(Math.floor(S.N / dpc), Math.floor(((r0 + rowsVis) * digitsPerRow) / dpc));
  el.range.textContent = `${S.mode === 'letters' ? 'letters' : 'digits'} ${fmt(a)} – ${fmt(b)}`;
  const mn = minTop(), mt = maxTop(), f = mt > mn ? (S.top - mn) / (mt - mn) : 0;
  const room = Math.max(0, el.rail.clientHeight - 26);
  el.thumb.style.transform = `translateY(${(f * room).toFixed(1)}px)`;
}


function viewTopFor(d) {
  const row = Math.floor(d / digitsPerRow);
  const centerY = 70 + (H - 70 - 190) / 2;                
  return clampTop(row - (centerY - cellH / 2) / cellH);
}

function jump(d) {
  const to = viewTopFor(d), dist = Math.abs(to - S.top);
  S.vel = 0;
  if (dist < rowsVis * 2.5) {
    S.anim = { from: S.top, to, t0: performance.now(), dur: Math.min(1000, 380 + dist * 14) };
  } else {
    S.anim = null; S.top = to;
    if (el.canvas.animate) el.canvas.animate(
      [{ opacity: 0, transform: 'scale(1.06)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }
  dirty();
}

function zoom(dir) {
  S.fs = Math.min(84, Math.max(12, Math.round(S.fs * (dir > 0 ? 1.12 : 1 / 1.12))));
  store.set('pi-fs', String(S.fs));
  layout();
}

el.canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) { zoomAcc -= e.deltaY; if (Math.abs(zoomAcc) > 40) { zoom(zoomAcc > 0 ? 1 : -1); zoomAcc = 0; } return; }
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 18; else if (e.deltaMode === 2) dy *= H;
  S.anim = null; S.vel = 0;
  S.top = clampTop(S.top + dy / cellH);
  dirty();
}, { passive: false });
let zoomAcc = 0;


let drag = null;
el.canvas.addEventListener('pointerdown', (e) => {
  el.canvas.setPointerCapture(e.pointerId);
  drag = { y: e.clientY, t: performance.now(), v: 0 };
  S.anim = null; S.vel = 0; el.canvas.classList.add('drag');
});
el.canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const now = performance.now(), dy = e.clientY - drag.y, dt = Math.max(1, now - drag.t);
  S.top = clampTop(S.top - dy / cellH);
  drag.v = 0.7 * drag.v + 0.3 * (-dy / cellH / dt);
  drag.y = e.clientY; drag.t = now; dirty();
});
const endDrag = () => {
  if (!drag) return;
  if (performance.now() - drag.t < 80 && Math.abs(drag.v) > 0.0006) { S.vel = Math.max(-0.08, Math.min(0.08, drag.v)); dirty(); }
  drag = null; el.canvas.classList.remove('drag');
};
el.canvas.addEventListener('pointerup', endDrag);
el.canvas.addEventListener('pointercancel', endDrag);


function railSet(e) {
  const r = el.rail.getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (e.clientY - r.top - 13) / Math.max(1, r.height - 26)));
  S.anim = null; S.vel = 0; S.top = minTop() + f * (maxTop() - minTop()); dirty();
}
el.rail.addEventListener('pointerdown', (e) => { el.rail.setPointerCapture(e.pointerId); el.rail.classList.add('drag'); railSet(e); });
el.rail.addEventListener('pointermove', (e) => { if (el.rail.classList.contains('drag')) railSet(e); });
el.rail.addEventListener('pointerup', () => el.rail.classList.remove('drag'));

window.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
  if (e.key === '/' && !typing) { e.preventDefault(); el.q.focus(); return; }
  if (e.key === 'Escape') { S.match = null; el.next.hidden = true; setStatus(''); el.q.blur(); dirty(); return; }
  if (typing || e.ctrlKey || e.metaKey) return;
  const page = Math.max(3, Math.floor(H / cellH) - 3);
  const moves = { PageDown: page, PageUp: -page, ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity };
  if (e.key in moves) {
    e.preventDefault(); S.vel = 0;
    const to = clampTop(moves[e.key] === Infinity ? maxTop() : moves[e.key] === -Infinity ? minTop() : S.top + moves[e.key]);
    if (Math.abs(moves[e.key]) <= page) S.anim = { from: S.top, to, t0: performance.now(), dur: 220 }; else S.top = to;
    dirty();
  }
});

el.goto.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const n = parseInt(el.goto.value.replace(/[^\d]/g, ''), 10);
  if (!(n >= 1)) return;
  const d = Math.min(S.N - 1, S.mode === 'letters' ? (n - 1) * 2 : n - 1);
  jump(d); el.goto.value = ''; el.goto.blur();
});

$('#zoomIn').addEventListener('click', () => zoom(1));
$('#zoomOut').addEventListener('click', () => zoom(-1));


const lettersToDigits = (s) => [...s.toLowerCase()].map((c) => String(c.charCodeAt(0) - 96).padStart(2, '0')).join('');
const pairLetter = (n) => String.fromCharCode(97 + ((n + 99) % 100) % 26);  
function digitsToLetters(s) {
  let out = '';
  for (let i = 0; i + 1 < s.length; i += 2) out += pairLetter(+s.slice(i, i + 2));
  return out;
}

function setMode(m) {
  if (m === S.mode) return;
  const v = el.q.value;
  el.q.value = m === 'letters' ? digitsToLetters(v) : lettersToDigits(v);
  S.mode = m;
  applyModeUi();
  layout();
  Snd.click();
}

function applyModeUi() {
  const letters = S.mode === 'letters';
  el.modeBtn.querySelectorAll('.seg').forEach((s) => s.classList.toggle('on', s.dataset.m === S.mode));
  el.q.classList.toggle('letters', letters);
  el.q.inputMode = letters ? 'text' : 'numeric';
  el.q.maxLength = letters ? MAX_DIGITS / 2 : MAX_DIGITS;
  el.q.placeholder = letters ? 'Type a word, e.g. cat   (a=01 … z=26, then 27=a again …)' : 'Type a sequence, e.g. 14159';
}

el.modeBtn.addEventListener('click', () => setMode(S.mode === 'digits' ? 'letters' : 'digits'));
el.q.addEventListener('input', () => {
  el.q.value = S.mode === 'letters' ? el.q.value.replace(/[^a-zA-Z]/g, '').toLowerCase() : el.q.value.replace(/\D/g, '');
});

/* ───────────────────────── search ───────────────────────── */
function setStatus(html, bad = false) {
  el.status.innerHTML = html;
  el.status.classList.toggle('bad', bad);
  el.status.classList.toggle('show', !!html);
}
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function runSearch({ mode, raw, from = 0, wrap = false, next = false }) {
  if (S.searching) return;
  Snd.unlock();
  S.searching = true; el.form.classList.add('busy'); el.go.disabled = true; el.next.disabled = true;
  setStatus(`Searching ${fmt(S.N)} digits…`);
  Snd.startSearch(); dirty();

  const t0 = performance.now();
  let res = null, failed = false;
  try {
    const r = await fetch(`/api/search?${mode === 'letters' ? 'w' : 'q'}=${raw}&from=${from}&wrap=${wrap ? 1 : 0}`);
    if (!r.ok) throw new Error('http ' + r.status);
    res = await r.json();
  } catch { failed = true; }
  const wait = MIN_SEARCH_MS - (performance.now() - t0);
  if (wait > 0) await sleep(wait);

  S.searching = false; el.form.classList.remove('busy'); el.go.disabled = false; el.next.disabled = false;
  Snd.stopSearch();

  if (failed) { Snd.fail(); setStatus('The server is busy or unreachable — try again.', true); dirty(); return; }

  const label = esc(mode === 'letters' ? raw.toUpperCase() : raw);
  if (res.found) {
    if (next && S.match && res.index === S.match.s) {
      Snd.found(); setStatus(`<b>${label}</b> appears only once in the first ${fmt(res.total)} digits`); dirty(); return;
    }
    S.match = { s: res.index, e: res.index + res.length };
    S.last = { mode, raw };
    S.pulseT0 = performance.now();
    el.next.hidden = false;
    Snd.found();
    const where = mode === 'letters'
      ? `letter <b>${fmt(res.index / 2 + 1)}</b> <span style="color:#777">(digit ${fmt(res.index + 1)})</span>`
      : `digit <b>${fmt(res.index + 1)}</b>`;
    setStatus(`Found <b>${label}</b> at ${where} · ${res.ms} ms`);
    jump(res.index);
  } else {
    S.match = null; S.last = null; el.next.hidden = true;
    Snd.fail();
    setStatus(`<b>${label}</b> was not found in the first ${fmt(res.total)} digits`, true);
    dirty();
  }
}

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = el.q.value.trim();
  if (!raw) { el.q.focus(); return; }
  el.q.blur();
  runSearch({ mode: S.mode, raw });
});
el.next.addEventListener('click', () => {
  if (!S.last || !S.match) return;
  runSearch({ ...S.last, from: S.match.s + 1, wrap: true, next: true });
});


const Snd = (() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ac = null, master = null, timer = 0, muted = store.get('pi-muted') === '1';

  function unlock() {
    if (!AC) return;
    if (!ac) {
      ac = new AC(); master = ac.createGain(); master.gain.value = 0.6;
      const comp = ac.createDynamicsCompressor(); master.connect(comp); comp.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
  }
  function tone({ f, f2, t = 0, d = 0.1, type = 'sine', g = 0.15, attack = 0.004 }) {
    if (!ac || muted) return;
    const t0 = ac.currentTime + t, o = ac.createOscillator(), a = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d);
    a.gain.setValueAtTime(0.0001, t0);
    a.gain.exponentialRampToValueAtTime(g, t0 + attack);
    a.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(a); a.connect(master); o.start(t0); o.stop(t0 + d + 0.03);
  }
  const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];

  function startSearch() {                    
    stopSearch(); if (!ac || muted) return;
    let i = 0;
    const tick = () => {
      const f = scale[(Math.random() * scale.length) | 0] * (Math.random() < 0.25 ? 2 : 1);
      tone({ f, d: 0.045, type: 'square', g: 0.04 });
      if (i % 4 === 0) tone({ f: f / 4, d: 0.07, type: 'triangle', g: 0.07 });
      i++;
    };
    tick(); timer = setInterval(tick, 58);
    tone({ f: 180, f2: 1700, d: 1.2, type: 'sawtooth', g: 0.016, attack: 0.25 });
  }
  function stopSearch() { if (timer) clearInterval(timer); timer = 0; }

  function found() {                        
    const n = [659.25, 830.61, 987.77, 1318.51];
    n.forEach((f, i) => { tone({ f, t: i * 0.075, d: 0.4, type: 'triangle', g: 0.17 }); tone({ f: f * 2, t: i * 0.075, d: 0.25, type: 'sine', g: 0.05 }); });
    tone({ f: 1318.51, t: 0.34, d: 0.8, type: 'sine', g: 0.12 }); tone({ f: 1661.22, t: 0.34, d: 0.8, type: 'sine', g: 0.07 });
  }
  function fail() {                           
    tone({ f: 196, f2: 92, d: 0.38, type: 'sawtooth', g: 0.13 });
    tone({ f: 155.56, f2: 73, t: 0.2, d: 0.5, type: 'sawtooth', g: 0.13 });
    tone({ f: 98, t: 0.2, d: 0.7, type: 'square', g: 0.04 });
  }
  function click() { tone({ f: 880, f2: 1500, d: 0.06, type: 'square', g: 0.04 }); }

  function setMuted(m) {
    muted = m; store.set('pi-muted', m ? '1' : '0');
    el.slash.style.display = m ? '' : 'none'; el.waves.style.display = m ? 'none' : '';
    if (m) stopSearch();
  }
  el.mute.addEventListener('click', () => { unlock(); setMuted(!muted); if (!muted) click(); });
  setMuted(muted);
  return { unlock, startSearch, stopSearch, found, fail, click };
})();


let rz = 0;
window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(layout, 80); });

(async function init() {
  applyModeUi();
  try {
    const info = await (await fetch('/api/info')).json();
    S.N = info.digits;
    el.total.textContent = `${fmt(S.N)} digits`;
  } catch { el.total.textContent = 'server offline'; }
  try { await Promise.all([document.fonts.load(`400 26px ${FAM}`), document.fonts.load(`700 26px ${FAM}`)]); } catch { /* fall back */ }
  layout();
  S.top = minTop(); dirty();
  $('#hint').textContent = 'scroll · drag · use the rail on the right · press / to search · Ctrl+scroll to zoom';
})();

})();
