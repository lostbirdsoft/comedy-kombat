// arena.js — арены: камера, параллакс-слои (картинки из github/img/arenas/<id>/ или заглушки) и классический «клуб».
// Рисует на переданный контекст, DOM игры не знает. Описание арен приходит с сервера (cloudflare-worker/src/arenas.js).
export const VIEW_W = 900, VIEW_H = 500, FLOOR = 432;
export const DEFAULT_ARENA = { id: "club", name: "Підвал стендап-клубу", emoji: "🎤", worldW: 900, style: "club", layers: [] };

// ---------- камера и геометрия слоёв (чистые функции, покрыты тестами) ----------
export const cameraTarget = (x1, x2, worldW, fw = 54) => Math.max(0, Math.min(worldW - VIEW_W, (x1 + x2) / 2 + fw / 2 - VIEW_W / 2));
export const stepCamera = (cam, target, k = 0.14) => Math.abs(target - cam) < 0.05 ? target : cam + (target - cam) * k;
export const requiredWidth = (worldW, f) => VIEW_W + (worldW - VIEW_W) * f;   // ширина слоя в логических px, чтобы хватило на весь проезд камеры
export function tileXs(imgW, off) { // где рисовать плитки слоя шириной imgW при сдвиге off (повторяется, если картинка короче нужного)
  const xs = []; let x = -(off % imgW); if (x > 0) x -= imgW; for (; x < VIEW_W; x += imgW) xs.push(x); return xs;
}
// Вырезание фона #FF00FF (для слоёв без альфа-канала). Правит RGBA-массив на месте; краям возвращает цвет (despill).
export function keyMagenta(d) {
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], m = Math.min(r, b) - g; // «пурпурность»
    if (m > 150) d[i + 3] = 0;
    else if (m > 60) { const t = (m - 60) / 90; d[i + 3] = Math.round(d[i + 3] * (1 - t)); d[i] = Math.round(r - (r - g) * t * 0.9); d[i + 2] = Math.round(b - (b - g) * t * 0.9); }
  }
}

// ---------- загрузка картинок ----------
let makeCanvas = () => document.createElement("canvas");
export const setCanvasFactory = f => { makeCanvas = f; };
const cache = new Map();
const tryLoad = url => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
async function loadStem(stem, ver) { for (const ext of ["png", "webp", "jpg"]) { const im = await tryLoad(stem + "." + ext + "?v=" + ver); if (im) return im; } return null; }
function prepare(img, chroma) { // уменьшаем до высоты экрана (экономия памяти на телефоне) и при необходимости вырезаем #FF00FF
  const sc = Math.min(VIEW_H / img.height, 4096 / img.width), w = Math.max(1, Math.round(img.width * sc)), h = Math.max(1, Math.round(img.height * sc));
  const cv = makeCanvas(); cv.width = w; cv.height = h; const g = cv.getContext("2d"); g.drawImage(img, 0, 0, w, h);
  if (chroma) { try { const id = g.getImageData(0, 0, w, h); keyMagenta(id.data); g.putImageData(id, 0, 0); } catch (e) {} }
  return cv;
}
export const makeState = cfg => ({ cfg, layers: {} });
export function loadArena(cfg, base, ver) { // не блокирует: пока картинка грузится (или её нет) слой рисуется заглушкой
  if (cache.has(cfg.id)) return cache.get(cfg.id);
  const st = makeState(cfg); cache.set(cfg.id, st);
  if (typeof Image === "undefined") return st;
  for (const L of cfg.layers) loadStem(base + cfg.id + "/" + L.key, ver).then(im => { if (im) st.layers[L.key] = prepare(im, L.key !== "back"); });
  return st;
}

// ---------- рисование ----------
export function drawBack(c, st, cam, tick) {
  const cfg = st.cfg;
  if (cfg.style === "club" || !cfg.layers.length) { drawClub(c, tick); return; }
  for (const L of cfg.layers) if (L.key !== "front") drawLayer(c, st, L, cam, tick);
}
export function drawFront(c, st, cam, tick) {
  const L = st.cfg.layers.find(l => l.key === "front"); if (L) drawLayer(c, st, L, cam, tick);
}
function drawLayer(c, st, L, cam, tick) {
  const cv = st.layers[L.key], off = cam * L.f;
  if (cv) { const iw = cv.width * VIEW_H / cv.height; for (const x of tileXs(iw, off)) c.drawImage(cv, Math.round(x), 0, Math.ceil(iw) + 1, VIEW_H); return; }
  const fn = PLACE[L.key]; if (fn) fn(c, st.cfg, off, tick);
}

export function drawClub(c, tick) { // классика: один экран
  const W = VIEW_W, H = VIEW_H;
  const gr = c.createLinearGradient(0, 0, 0, FLOOR); gr.addColorStop(0, "#1a0f24"); gr.addColorStop(1, "#3a1738"); c.fillStyle = gr; c.fillRect(0, 0, W, FLOOR);
  c.fillStyle = "#4c1320"; for (let x = 0; x < W; x += 90) { c.fillRect(x, 0, 60, FLOOR - 40); c.fillStyle = x % 180 ? "#4c1320" : "#5a1828"; }
  c.fillStyle = "rgba(255,244,180,.08)"; [200, 450, 700].forEach(sx => { c.beginPath(); c.moveTo(sx - 20, 0); c.lineTo(sx + 20, 0); c.lineTo(sx + 130, FLOOR); c.lineTo(sx - 130, FLOOR); c.fill(); });
  c.fillStyle = "#f472b6"; c.font = "bold 22px Impact,Arial Black,sans-serif"; c.textAlign = "center"; c.globalAlpha = .55 + .15 * Math.sin(tick / 20); c.fillText("★ STAND-UP LIVE ★", W / 2, 130); c.globalAlpha = 1;
  c.fillStyle = "#222"; c.fillRect(W / 2 - 2, 270, 4, FLOOR - 270); c.beginPath(); c.arc(W / 2, 266, 9, 0, 6.283); c.fill();
  c.fillStyle = "#2a2230"; c.fillRect(0, FLOOR, W, H - FLOOR); c.fillStyle = "#5b4a68"; c.fillRect(0, FLOOR, W, 6);
  c.fillStyle = "#0a0810"; for (let x = 10; x < W; x += 46) { const b = Math.sin(tick / 25 + x) * 2; c.beginPath(); c.arc(x, H - 10 + b, 17, 0, 6.283); c.fill(); }
}

// ---------- заглушки (пока нет картинок): простые силуэты по палитре арены, чтобы уровень уже ехал и читался ----------
const hash = s => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const rnd = seed => { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };
const poly = (c, pts) => { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.closePath(); c.fill(); };
function hills(c, color, off, W, base, amp, R) {
  const ph = R() * 6; c.fillStyle = color; c.beginPath(); c.moveTo(-off, VIEW_H);
  for (let x = 0; x <= W + 20; x += 20) c.lineTo(x - off, base - amp * (Math.sin(x * 0.006 + ph) + 0.6 * Math.sin(x * 0.017 + ph * 2)));
  c.lineTo(W - off, VIEW_H); c.closePath(); c.fill();
}
function skyline(c, color, lit, off, W, base, hmin, hmax, R, step) {
  for (let x = 0; x < W; x += step) {
    const w = 50 + R() * 70, h = hmin + R() * (hmax - hmin); c.fillStyle = color; c.fillRect(x - off, base - h, w, h);
    if (lit) { c.fillStyle = lit; for (let wy = base - h + 12; wy < base - 14; wy += 22) for (let wx = x + 8; wx < x + w - 10; wx += 16) if (R() < 0.35) c.fillRect(wx - off, wy, 6, 9); }
    x += w * 0.3;
  }
}
const sunDisk = (c, x, y, r, color, glow) => { const g = c.createRadialGradient(x, y, r * 0.2, x, y, r * 2.6); g.addColorStop(0, glow); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(x - r * 3, y - r * 3, r * 6, r * 6); c.fillStyle = color; c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill(); };
function sky(c, p) { const g = c.createLinearGradient(0, 0, 0, FLOOR); g.addColorStop(0, p.sky1); g.addColorStop(1, p.sky2); c.fillStyle = g; c.fillRect(0, 0, VIEW_W, VIEW_H); }

const PLACE = {
  back(c, cfg, off, tick) {
    const p = cfg.palette, R = rnd(hash(cfg.id + "b")), W = requiredWidth(cfg.worldW, 0.25); sky(c, p);
    if (cfg.style === "gas") { for (let i = 0; i < 80; i++) { const x = R() * W, y = R() * 250, a = 0.35 + 0.5 * Math.abs(Math.sin(tick / 30 + i)); c.fillStyle = "rgba(255,255,255," + a.toFixed(2) + ")"; c.fillRect(x - off, y, 2, 2); } sunDisk(c, 820 - off, 110, 26, "#fef3c7", "rgba(254,243,199,.35)"); hills(c, p.far, off, W, 345, 38, R); }
    else if (cfg.style === "market") { sunDisk(c, 700 - off, 120, 40, "#fffbeb", "rgba(255,251,235,.5)"); skyline(c, "rgba(180,83,9,.35)", null, off, W, 360, 60, 150, R, 10); }
    else if (cfg.style === "hall") { c.fillStyle = "rgba(0,0,0,.25)"; c.fillRect(0, 0, VIEW_W, 70); for (let x = 40; x < W; x += 170) { c.fillStyle = "#292524"; c.fillRect(x - off, 120, 80, 200); c.beginPath(); c.arc(x + 40 - off, 120, 40, Math.PI, 0); c.fill(); c.fillStyle = "rgba(251,191,36,.18)"; c.fillRect(x + 8 - off, 134, 64, 180); } }
    else if (cfg.style === "station") { sunDisk(c, 640 - off, 300, 46, "#fff7ed", "rgba(253,186,116,.55)"); skyline(c, p.far, "rgba(253,224,71,.8)", off, W, 372, 70, 170, R, 6); }
    else { sunDisk(c, 600 - off, 270, 60, "#fef08a", "rgba(251,146,60,.5)"); skyline(c, p.far, "rgba(254,240,138,.7)", off, W, 372, 60, 190, R, 8); }
  },
  mid(c, cfg, off, tick) {
    const p = cfg.palette, R = rnd(hash(cfg.id + "m")), W = requiredWidth(cfg.worldW, 0.6), base = FLOOR - 4;
    if (cfg.style === "gas") { for (let x = 120; x < W; x += 250) { const px = x - off; c.fillStyle = p.mid; c.fillRect(px, base - 250, 7, 250); c.fillRect(px - 4, base - 255, 36, 9);
        const g = c.createRadialGradient(px + 24, base - 246, 2, px + 24, base - 246, 120); g.addColorStop(0, "rgba(251,191,36,.40)"); g.addColorStop(1, "rgba(251,191,36,0)"); c.fillStyle = g; c.fillRect(px - 100, base - 370, 250, 250); }
      for (let x = 40; x < W; x += 170 + R() * 80) { const px = x - off; c.fillStyle = "#14122b"; poly(c, [[px, base], [px + 26, base - 90], [px + 52, base]]); poly(c, [[px + 6, base - 50], [px + 26, base - 130], [px + 46, base - 50]]); } }
    else if (cfg.style === "market") { for (let x = 30; x < W; x += 240) { const px = x - off; c.fillStyle = p.mid; c.fillRect(px, base - 70, 170, 70);
        for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? "#fef3c7" : p.accent; poly(c, [[px - 10 + i * 31, base - 140], [px + 21 + i * 31, base - 140], [px + 26 + i * 31, base - 100], [px - 15 + i * 31, base - 100]]); }
        c.fillStyle = "#7c2d12"; c.fillRect(px, base - 140, 4, 140); c.fillRect(px + 166, base - 140, 4, 140); } }
    else if (cfg.style === "hall") { for (let x = 60; x < W; x += 300) { const px = x - off; c.fillStyle = p.mid; c.fillRect(px, base - 340, 62, 340); c.fillStyle = "#a16207"; c.fillRect(px - 8, base - 350, 78, 16); c.fillRect(px - 8, base - 16, 78, 16); c.fillStyle = "rgba(255,255,255,.12)"; c.fillRect(px + 8, base - 330, 8, 320); } }
    else if (cfg.style === "station") { c.fillStyle = "#1f2a44"; c.fillRect(260 - off, base - 170, 760, 170); c.fillStyle = "#2f3d63"; c.fillRect(260 - off, base - 195, 760, 25); for (let x = 280; x < 1000; x += 80) { c.fillStyle = "rgba(253,224,71,.85)"; c.fillRect(x - off, base - 140, 46, 56); }
      for (let x = 90; x < W; x += 340) { c.fillStyle = p.mid; c.fillRect(x - off, base - 320, 30, 320); } c.fillRect(0 - off, base - 330, W, 16); }
    else { skyline(c, p.mid, "rgba(254,240,138,.55)", off, W, base, 120, 260, R, 14); c.fillStyle = "#1a0d2b"; for (let x = 100; x < W; x += 210) { c.fillRect(x - off, base - 300, 3, 60); c.fillRect(x - 14 - off, base - 290, 31, 3); c.fillRect(x - 9 - off, base - 276, 21, 3); } }
  },
  ground(c, cfg, off, tick) {
    const p = cfg.palette, R = rnd(hash(cfg.id + "g")), W = cfg.worldW, base = FLOOR;
    const g = c.createLinearGradient(0, base, 0, VIEW_H); g.addColorStop(0, p.ground); g.addColorStop(1, "rgba(0,0,0,.85)"); c.fillStyle = p.ground; c.fillRect(0, base, VIEW_W, VIEW_H - base); c.fillStyle = g; c.fillRect(0, base, VIEW_W, VIEW_H - base);
    c.fillStyle = "rgba(255,255,255,.07)"; for (let x = 0; x <= W; x += 80) c.fillRect(x - off, base, 2, VIEW_H - base);
    c.fillStyle = p.accent; c.globalAlpha = 0.55; c.fillRect(0, base, VIEW_W, 3); c.globalAlpha = 1;
    // реквизит за ногами бойцов
    for (let x = 160; x < W - 60; x += 230 + R() * 140) { const px = x - off; c.fillStyle = "rgba(0,0,0,.38)";
      if (cfg.style === "gas") { c.fillRect(px, base - 92, 44, 92); c.fillStyle = p.accent; c.fillRect(px, base - 92, 44, 10); c.fillStyle = "#0f172a"; c.fillRect(px + 8, base - 70, 28, 22); }
      else if (cfg.style === "market") { c.fillRect(px, base - 44, 54, 44); c.fillRect(px + 14, base - 80, 46, 36); c.fillStyle = "rgba(239,68,68,.55)"; c.beginPath(); c.arc(px + 80, base - 14, 13, 0, 6.283); c.arc(px + 100, base - 14, 13, 0, 6.283); c.fill(); }
      else if (cfg.style === "hall") { c.fillRect(px, base - 70, 5, 70); c.fillRect(px + 90, base - 70, 5, 70); c.fillStyle = "rgba(251,191,36,.5)"; c.fillRect(px, base - 62, 95, 4); }
      else if (cfg.style === "station") { c.fillRect(px, base - 40, 90, 8); c.fillRect(px + 6, base - 32, 6, 32); c.fillRect(px + 78, base - 32, 6, 32); c.fillRect(px, base - 74, 90, 6); }
      else { c.fillRect(px, base - 36, 56, 36); c.fillStyle = "rgba(0,0,0,.5)"; c.fillRect(px + 70, base - 100, 4, 100); c.fillRect(px + 150, base - 100, 4, 100); c.fillStyle = "rgba(250,250,250,.35)"; c.fillRect(px + 74, base - 96, 76, 3); } }
    if (cfg.style === "hall") { c.fillStyle = "rgba(185,28,28,.75)"; c.fillRect(0, base + 14, VIEW_W, 30); }
    // стены по краям мира
    for (const wx of [-4, W - 20]) { c.fillStyle = "#0b0a10"; c.fillRect(wx - off, 0, 24, base); c.fillStyle = p.accent; c.globalAlpha = .6; c.fillRect(wx + (wx < 100 ? 24 : 0) - off, 0, 3, base); c.globalAlpha = 1; }
  },
  front(c, cfg, off, tick) {
    const p = cfg.palette, R = rnd(hash(cfg.id + "f")), W = requiredWidth(cfg.worldW, 1.4); c.fillStyle = "rgba(6,4,12,.92)";
    for (let x = 0; x < W; x += 36 + R() * 24) { c.beginPath(); c.arc(x - off, VIEW_H - 4, 16 + R() * 10, 0, 6.283); c.fill(); c.fillRect(x - 22 - off, VIEW_H - 4, 44, 6); }
  }
};
