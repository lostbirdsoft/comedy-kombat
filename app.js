// COMEDY KOMBAT v0.2 — клиент Mini App. Рисует состояние от сервера (Cloudflare Worker),
// свой боец двигается мгновенно (предсказание), чужой — плавно с небольшой задержкой.
import { Predictor, SnapBuffer } from "./predict.js?v=2";

const WORKER_URL = "wss://comedy-kombat.lostbirdsoft.workers.dev"; // ← вписать после деплоя воркера
const W = 900, H = 500, FLOOR = 432, FH = 142, FW = 54, INTERP_MS = 75;

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); try { tg.disableVerticalSwipes?.(); tg.setHeaderColor?.("#0c0a12"); tg.setBackgroundColor?.("#0c0a12"); } catch (e) {} }
const params = new URLSearchParams(location.search);
const roomId = tg?.initDataUnsafe?.start_param || params.get("room") || "";
// Локальный тест без Telegram: ?room=room_test&dev=Імя (нужен ALLOW_DEV="1" на сервере)
const initData = tg?.initData || (params.get("dev") ? "dev:" + params.get("dev") : "");
const $ = id => document.getElementById(id);
const el = { status: $("status"), roomTag: $("roomTag"), resign: $("resignBtn"), wait: $("screenWait"), select: $("screenSelect"),
  fight: $("screenFight"), grid: $("grid"), ready: $("readyBtn"), result: $("result"), rematch: $("rematchBtn"), sound: $("soundBtn") };
const setStatus = t => { el.status.textContent = t; };
if (!/^[a-zA-Z0-9_-]{1,50}$/.test(roomId)) { setStatus("Не вдалося визначити кімнату. Відкрийте запрошення з чату."); throw new Error("bad room"); }
el.roomTag.textContent = roomId.slice(-6).toUpperCase();

let me = { slot: 0, spectator: false }, roster = [], camps = {}, players = {}, lobby = null, snap = null, picked = null, pauseInfo = null;
const byId = id => roster.find(c => c.id === id);
const mySlotIdx = () => me.slot - 1;
const imPlayer = () => me.slot > 0 && !me.spectator;

// ---------- Сеть ----------
let ws = null, reqId = 0, rtt = 100, pingSent = 0; const pending = new Map();
function call(action, data = {}) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) return reject(new Error("Немає зʼєднання"));
    const id = ++reqId; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, action, ...data }));
    setTimeout(() => { if (pending.delete(id)) reject(new Error("Сервер не відповів")); }, 15000);
  });
}
const sendFast = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
setInterval(() => { if (ws && ws.readyState === 1) { pingSent = performance.now(); ws.send("ping"); } }, 1000); // и keepalive, и замер пинга

function connect() {
  setStatus("Підключаємось…");
  ws = new WebSocket(WORKER_URL.replace(/\/$/, "") + "/ws?room=" + encodeURIComponent(roomId));
  ws.onopen = async () => {
    try {
      const r = await call("join", { initData });
      me = { slot: r.player, spectator: !!r.spectator }; roster = r.roster; camps = r.camps; players = r.players;
      buildGrid(); setStatus(me.spectator ? "Ви спостерігач 👀" : "Ви — гравець " + me.slot);
      resendHeld(); render();
    } catch (e) { setStatus(e.message); }
  };
  ws.onmessage = ev => {
    if (ev.data === "pong") { if (pingSent) rtt = rtt * 0.7 + (performance.now() - pingSent) * 0.3; return; }
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.type === "lobby") { lobby = m; players = m.players; if (m.status !== "active") pauseInfo = null; if (m.status === "select" || m.status === "waiting") snap = null; render(); }
    else if (m.type === "snap") onSnap(m);
    else if (m.type === "pause") pauseInfo = m.slot ? { slot: m.slot, left: m.left } : null;
    else if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m) : p.reject(new Error(m.error || "Помилка")); }
  };
  ws.onclose = () => { setStatus("Звʼязок втрачено, перепідключення…"); setTimeout(connect, 1200); };
}

// ---------- Экраны ----------
const show = name => { for (const k of ["wait", "select", "fight"]) el[k].hidden = k !== name; };
function render() {
  if (!lobby || !roster.length) return;
  const st = lobby.status;
  try { st === "active" && imPlayer() ? tg?.enableClosingConfirmation?.() : tg?.disableClosingConfirmation?.(); } catch (e) {}
  el.resign.hidden = !(st === "active" && imPlayer());
  if (st === "waiting") { show("wait"); return; }
  if (st === "select") { show("select"); renderSelect(); return; }
  show("fight");
  $("controls").hidden = !imPlayer() || st === "finished";
  if (imPlayer() && lobby.chars) { const ch = byId(lobby.chars[mySlotIdx()]); if (ch) $("specName").textContent = ch.special.name.split(" ").slice(0, 2).join(" "); }
  if (st === "finished") {
    const w = lobby.winner, wc = lobby.chars && byId(lobby.chars[w - 1]);
    $("resTitle").textContent = "🏆 " + ((players[w] && players[w].name) || "Боєць") + (wc ? " (" + wc.name + ")" : "");
    $("resSub").textContent = lobby.reason || "";
    el.rematch.hidden = me.spectator;
    const voted = lobby.rematch && lobby.rematch[me.slot];
    el.rematch.disabled = !!voted; el.rematch.textContent = voted ? "ЧЕКАЄМО СУПЕРНИКА…" : "РЕВАНШ";
    el.result.hidden = false; releaseAll();
  } else el.result.hidden = true;
}
function buildGrid() {
  el.grid.innerHTML = "";
  roster.forEach(ch => {
    const b = document.createElement("button"); b.className = "card"; b.dataset.id = ch.id;
    const c = document.createElement("canvas"); c.width = 60; c.height = 84; b.appendChild(c);
    const n = document.createElement("b"); n.textContent = ch.name; b.appendChild(n);
    b.onclick = () => pick(ch.id); el.grid.appendChild(b);
    const g = c.getContext("2d"); g.scale(.5, .5); g.translate(3, 164 - FLOOR); drawFighter(g, ch, { fc: 1 }, 0, FLOOR - FH, 0);
  });
}
async function pick(id) {
  if (me.spectator || (lobby.locked && lobby.locked[me.slot])) return;
  picked = id; renderSelect();
  try { await call("pick", { char: id }); } catch (e) { setStatus(e.message); }
}
function renderSelect() {
  const mine = (lobby.picks && lobby.picks[me.slot]) || picked, locked = lobby.locked && lobby.locked[me.slot], opp = me.slot === 1 ? 2 : 1;
  [...el.grid.children].forEach(b => { b.classList.toggle("sel", b.dataset.id === mine); b.classList.toggle("locked", !!locked && b.dataset.id !== mine); });
  const ch = byId(mine || ((lobby.picks && lobby.picks[1]) || roster[0].id));
  const pc = $("prevCanvas").getContext("2d"); pc.clearRect(0, 0, 170, 190); pc.save(); pc.translate(58, 178 - FLOOR); drawFighter(pc, ch, { fc: 1 }, 0, FLOOR - FH, 0); pc.restore();
  const camp = camps[ch.camp] || {};
  $("prevCamp").textContent = camp.name || ""; $("prevCamp").style.color = camp.color || "#fff";
  $("prevName").textContent = ch.name; $("prevTitle").textContent = ch.title;
  $("prevSpecial").textContent = "✨ " + ch.special.name; $("prevTaunt").textContent = "«" + ch.taunt + "»";
  const on = (players[opp] && players[opp].name) || "суперник";
  $("vsLine").textContent = me.spectator ? "Гравці обирають бійців…" : (lobby.locked && lobby.locked[opp] ? on + " уже готовий!" : on + " обирає бійця…");
  el.ready.disabled = me.spectator || !mine || !!locked; el.ready.textContent = locked ? "ЧЕКАЄМО СУПЕРНИКА…" : "ОБРАТИ БІЙЦЯ";
}
el.ready.onclick = async () => { try { await call("ready"); } catch (e) { setStatus(e.message); } };
el.rematch.onclick = async () => { try { await call("rematch"); } catch (e) { setStatus(e.message); } };
el.resign.onclick = async () => { if (confirm("Здатися?")) { try { await call("resign"); } catch (e) { setStatus(e.message); } } };

// ---------- Звук (синтез, без файлов; iOS: разблокировка по первому касанию) ----------
let actx = null, soundOn = localStorage.getItem("ck_sound") !== "0";
el.sound.textContent = soundOn ? "🔊" : "🔇";
el.sound.onclick = () => { soundOn = !soundOn; localStorage.setItem("ck_sound", soundOn ? "1" : "0"); el.sound.textContent = soundOn ? "🔊" : "🔇"; unlockAudio(); };
function unlockAudio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    const b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
  } catch (e) {}
}
addEventListener("pointerdown", unlockAudio, { once: false, passive: true });
function snd(freq, type, dur, vol = .14, delay = 0) {
  if (!soundOn) return;
  try {
    unlockAudio(); if (!actx) return;
    const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(40, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.005, t + dur);
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur);
  } catch (e) {}
}
const laugh = () => [0, .12, .24, .36].forEach((d, i) => snd(420 - i * 40, "square", .09, .12, d));
const haptic = (k = "medium") => { try { tg?.HapticFeedback?.impactOccurred(k); } catch (e) {} };

// ---------- Бой: снимки, предсказание, эффекты ----------
const cv = $("game"), c = cv.getContext("2d");
const buf = new SnapBuffer(), pred = new Predictor(); let lastRd = 0, lastPh = "", localAtk = null;
let shake = 0; const parts = [];
function spawn(x, y, dir, cols, n) {
  for (let i = 0; i < n; i++) parts.push({ x, y, c: cols[i % cols.length], vx: (Math.random() * 6.5 + 1.5) * dir, vy: (Math.random() - .72) * 8.5, s: Math.random() * 4 + 2, life: 28 + Math.random() * 20 });
}
const JUICE = ["#b91c1c", "#ef4444", "#fca5a5", "#fde68a"];
function predCtx(m) {
  const f = m.f[mySlotIdx()], ch = byId((lobby && lobby.chars || [])[mySlotIdx()]), st = ch ? ch.stats : { speed: 5.2, jump: 17.5 };
  return { free: m.ph === "fight" && !f.st && !f.fr && !f.dd && !f.kd, busy: !!f.at || localActive(), speed: st.speed, jumpV: st.jump };
}
const localActive = () => localAtk && performance.now() < localAtk.until;
function onSnap(m) {
  const now = performance.now(); snap = m; buf.push(now, m);
  if (imPlayer()) {
    if (m.rd !== lastRd || (m.ph === "intro" && lastPh !== "intro")) pred.reset();
    pred.onSnap(now, m.f[mySlotIdx()], predCtx(m), rtt);
  }
  lastRd = m.rd; lastPh = m.ph;
  for (const e of m.ev) {
    const k = e[0];
    if (k === "hit") { spawn(e[1], e[2], e[3], JUICE, Math.min(26, e[4] * 2)); shake = 9; snd(110, "sawtooth", .18, .22); if (imPlayer()) haptic("heavy"); }
    else if (k === "block") { spawn(e[1], e[2], -e[3], ["#fff", "#93c5fd"], 8); snd(170, "square", .1, .14); }
    else if (k === "swing") { if (!(imPlayer() && e[1] === mySlotIdx())) snd(210, "sine", .08, .1); }
    else if (k === "special") { if (!(imPlayer() && e[1] === mySlotIdx())) snd(330, "triangle", .22, .16); }
    else if (k === "tele") { spawn(e[2], 330, 1, ["#93c5fd", "#fff"], 18); snd(700, "sine", .25, .15); }
    else if (k === "ko") { snd(88, "sawtooth", .8, .26); laugh(); shake = 14; }
    else if (k === "fatality") { spawn(e[2], e[3], e[4], ["#fde68a", "#f472b6", "#60a5fa", "#fff", "#ef4444"], 90); snd(58, "sawtooth", 1.2, .3); laugh(); shake = 22; }
  }
}

// ---------- Отрисовка бойца ----------
function drawFighter(g, ch, s, x, y, t) {
  g.save();
  const fc = s.fc || 1, sp = ch.special, cx = x + 27;
  g.fillStyle = "rgba(0,0,0,.5)"; g.beginPath(); g.ellipse(cx, FLOOR, 35, 8, 0, 0, 6.283); g.fill();
  if (s.dd || s.kd) { // лежит (нокаут, подсечка, апперкот)
    const ly = y + FH - 28;
    g.fillStyle = ch.color; g.fillRect(x - 22, ly, 112, 28); g.fillStyle = ch.skin; g.fillRect(fc === 1 ? x - 22 : x + 68, ly + 2, 22, 22);
    if (s.bu) flames(g, x - 10, ly - 10, 100, t, 3); if (s.fr) iceBlock(g, x - 26, ly - 6, 120, 38);
    g.restore(); return;
  }
  if (s.cr) { g.translate(cx, y + FH); g.scale(1, .62); g.translate(-cx, -(y + FH)); }
  if (s.at === "special" && sp.kind === "teleport") g.globalAlpha = .55;
  if (s.at === "special" && sp.kind === "dash") { // рывок-ядро
    g.fillStyle = ch.color; g.beginPath(); g.arc(cx, y + 85, 42, 0, 6.283); g.fill();
    g.fillStyle = ch.trim; g.beginPath(); g.arc(cx + 10 * fc, y + 78, 14, 0, 6.283); g.fill(); g.restore(); return;
  }
  g.fillStyle = "#18181b"; g.fillRect(x + 8, y + 82, 15, 60); g.fillRect(x + 31, y + 82, 15, 60);
  g.fillStyle = "#27272a"; g.fillRect(x + 6, y + 34, 42, 52);
  g.fillStyle = ch.color; g.fillRect(x + 8, y + 34, 12, 50); g.fillRect(x + 34, y + 34, 12, 50); g.fillRect(x + 14, y + 74, 26, 12);
  if (ch.look === "suit") { g.fillStyle = "#e5e7eb"; g.fillRect(x + 20, y + 34, 14, 36); g.fillStyle = ch.trim; g.fillRect(x + 25, y + 36, 5, 28); }
  g.fillStyle = ch.skin; g.fillRect(cx - 13, y + 6, 26, 26);
  const L = ch.look;
  if (L === "cap") { g.fillStyle = ch.color; g.fillRect(cx - 14, y + 2, 28, 10); g.fillRect(fc === 1 ? cx : cx - 22, y + 9, 22, 5); }
  else if (L === "hair") { g.fillStyle = "#3b2a2a"; g.fillRect(cx - 15, y + 2, 30, 10); g.fillRect(cx - 15, y + 8, 6, 28); g.fillRect(cx + 9, y + 8, 6, 28); }
  else if (L === "hat") { g.fillStyle = "#3f2d12"; g.fillRect(cx - 22, y + 8, 44, 5); g.fillRect(cx - 12, y - 6, 24, 14); g.fillStyle = ch.trim; g.fillRect(cx - 12, y + 3, 24, 3); }
  else if (L === "crown") { g.fillStyle = "#fbbf24"; g.beginPath(); g.moveTo(cx - 15, y + 8); g.lineTo(cx - 15, y - 8); g.lineTo(cx - 7, y); g.lineTo(cx, y - 10); g.lineTo(cx + 7, y); g.lineTo(cx + 15, y - 8); g.lineTo(cx + 15, y + 8); g.fill(); }
  else if (L === "mask") { g.fillStyle = ch.color; g.fillRect(cx - 14, y + 4, 28, 8); g.fillRect(cx - 13, y + 18, 26, 14); }
  else if (L === "suit") { g.fillStyle = "#64748b"; g.fillRect(cx - 14, y + 3, 28, 8); }
  else { g.fillStyle = "rgba(255,255,255,.35)"; g.fillRect(cx - 6, y + 8, 6, 3); }
  g.fillStyle = "#09090b"; g.fillRect(cx + (fc === 1 ? 3 : -9), y + 14, 6, 4);
  if (s.bl) { g.fillStyle = ch.trim; g.fillRect(cx + (fc === 1 ? 14 : -24), y + 36, 10, 44); }
  else if (s.at === "upper") { // апперкот: кулак вверх
    g.fillStyle = ch.skin; g.fillRect(fc === 1 ? x + FW - 4 : x - 8, y - 14, 12, 66);
    g.fillStyle = "#111"; g.beginPath(); g.arc(fc === 1 ? x + FW + 2 : x - 2, y - 16, 9, 0, 6.283); g.fill();
  } else if (s.at === "sweep") { g.fillStyle = "#18181b"; g.fillRect(fc === 1 ? x + FW : x - 84, y + 118, 84, 14); }
  else if (s.at === "air") { // удар ногой в прыжке
    g.strokeStyle = "#18181b"; g.lineWidth = 15; g.lineCap = "round"; g.beginPath(); g.moveTo(cx + fc * 6, y + 84); g.lineTo(cx + fc * 68, y + 116); g.stroke();
  } else if (s.at === "punch" || s.at === "special") {
    const big = sp.kind === "smash" && s.at === "special", len = big ? 70 : 44, ax = fc === 1 ? x + FW : x - len;
    g.fillStyle = ch.skin; g.fillRect(ax, y + 40, len, 12);
    g.fillStyle = big ? ch.trim : "#111"; // микрофон / молот
    if (big) g.fillRect(fc === 1 ? ax + len - 8 : ax - 14, y + 22, 22, 46); else g.fillRect(fc === 1 ? ax + len - 6 : ax - 4, y + 36, 10, 20);
  } else if (s.at === "kick") { g.fillStyle = "#18181b"; g.fillRect(fc === 1 ? x + FW : x - 60, y + 70, 60, 15); }
  if (s.st && !s.fr) { g.fillStyle = "#fde047"; for (let i = 0; i < 3; i++) { const a = t * .15 + i * 2.1; g.fillRect(cx + Math.cos(a) * 16 - 2, y - 6 + Math.sin(a) * 4, 5, 5); } }
  if (s.bu) flames(g, x - 4, y, FW + 8, t, 6);
  if (s.fr) iceBlock(g, x - 6, y - 4, FW + 12, FH + 4);
  g.restore();
}
function flames(g, x, y, w, t, n) { // горение
  for (let k = 0; k < n; k++) {
    const fx = x + (w / n) * (k + .5), base = y + 130 - ((k * 37 + t * 2.2) % 100), hh = 16 + 8 * Math.sin(t * .3 + k * 1.7);
    g.fillStyle = k % 2 ? "rgba(249,115,22,.85)" : "rgba(253,224,71,.85)";
    g.beginPath(); g.moveTo(fx - 7, base); g.quadraticCurveTo(fx, base - hh, fx + 2 * Math.sin(t * .4 + k), base - hh - 8); g.quadraticCurveTo(fx + 2, base - hh, fx + 7, base); g.fill();
  }
}
function iceBlock(g, x, y, w, h) { // заморозка: глыба, блик и сосульки
  g.fillStyle = "rgba(150,235,255,.55)"; g.strokeStyle = "#fff"; g.lineWidth = 2; g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h);
  g.fillStyle = "rgba(255,255,255,.55)"; g.beginPath(); g.moveTo(x + 6, y + h * .35); g.lineTo(x + 18, y + 6); g.lineTo(x + 26, y + 10); g.lineTo(x + 14, y + h * .45); g.fill();
  g.fillStyle = "rgba(200,245,255,.9)"; for (let k = 0; k < 4; k++) { const ix = x + 5 + k * (w - 10) / 4; g.beginPath(); g.moveTo(ix, y + h); g.lineTo(ix + 8, y + h); g.lineTo(ix + 4, y + h + 11); g.fill(); }
}

// ---------- Арена, снаряды, HUD ----------
let tick = 0;
function drawArena() {
  const gr = c.createLinearGradient(0, 0, 0, FLOOR); gr.addColorStop(0, "#1a0f24"); gr.addColorStop(1, "#3a1738"); c.fillStyle = gr; c.fillRect(0, 0, W, FLOOR);
  c.fillStyle = "#4c1320"; for (let x = 0; x < W; x += 90) { c.fillRect(x, 0, 60, FLOOR - 40); c.fillStyle = x % 180 ? "#4c1320" : "#5a1828"; }
  c.fillStyle = "rgba(255,244,180,.08)"; [200, 450, 700].forEach(sx => { c.beginPath(); c.moveTo(sx - 20, 0); c.lineTo(sx + 20, 0); c.lineTo(sx + 130, FLOOR); c.lineTo(sx - 130, FLOOR); c.fill(); });
  c.fillStyle = "#f472b6"; c.font = "bold 22px Impact,Arial Black,sans-serif"; c.textAlign = "center"; c.globalAlpha = .55 + .15 * Math.sin(tick / 20); c.fillText("★ STAND-UP LIVE ★", W / 2, 130); c.globalAlpha = 1;
  c.fillStyle = "#222"; c.fillRect(W / 2 - 2, 270, 4, FLOOR - 270); c.beginPath(); c.arc(W / 2, 266, 9, 0, 6.283); c.fill();
  c.fillStyle = "#2a2230"; c.fillRect(0, FLOOR, W, H - FLOOR); c.fillStyle = "#5b4a68"; c.fillRect(0, FLOOR, W, 6);
  c.fillStyle = "#0a0810"; for (let x = 10; x < W; x += 46) { const b = Math.sin(tick / 25 + x) * 2; c.beginPath(); c.arc(x, H - 10 + b, 17, 0, 6.283); c.fill(); }
}
function drawProjectile(p) {
  if (p.k === "shockwave") { c.fillStyle = p.c; c.beginPath(); c.moveTo(p.x - 14 * p.d, FLOOR); c.lineTo(p.x + 14 * p.d, FLOOR); c.lineTo(p.x, FLOOR - 34); c.fill(); return; }
  if (p.e === "pull") {
    c.strokeStyle = "#a1a1aa"; c.lineWidth = 3; c.beginPath(); c.moveTo(p.x0 + (p.d === 1 ? FW : 0), p.y); c.lineTo(p.x, p.y); c.stroke();
    c.fillStyle = p.c; c.beginPath(); c.moveTo(p.x + 14 * p.d, p.y); c.lineTo(p.x - 8 * p.d, p.y - 7); c.lineTo(p.x - 8 * p.d, p.y + 7); c.fill(); return;
  }
  c.fillStyle = p.c; c.beginPath(); c.arc(p.x, p.y, 15, 0, 6.283); c.fill();
  c.fillStyle = "#fff"; c.beginPath(); c.arc(p.x - 3 * p.d, p.y - 3, 6, 0, 6.283); c.fill();
}
function fit(text, maxW, size) { c.font = "bold " + size + "px Impact,Arial Black,sans-serif"; while (c.measureText(text).width > maxW && size > 14) { size -= 2; c.font = "bold " + size + "px Impact,Arial Black,sans-serif"; } }
function drawHUD(m) {
  const bw = 350, bh = 24;
  for (let i = 0; i < 2; i++) {
    const ch = byId((lobby.chars || [])[i]); if (!ch) continue;
    const f = m.f[i], ratio = Math.max(0, f.hp / ch.stats.hp), left = i === 0, x = left ? 40 : W - 40 - bw;
    c.fillStyle = "#450a0a"; c.fillRect(x, 26, bw, bh);
    c.fillStyle = ratio > .3 ? ch.color : "#ef4444"; c.fillRect(left ? x : x + bw * (1 - ratio), 26, bw * ratio, bh);
    c.strokeStyle = "#fff"; c.lineWidth = 2; c.strokeRect(x, 26, bw, bh);
    c.fillStyle = "#fff"; c.textAlign = left ? "left" : "right"; fit(ch.name, 300, 17); c.fillText(ch.name, left ? 46 : W - 46, 45);
    const pn = (players[i + 1] && players[i + 1].name) || ""; c.font = "12px Arial"; c.fillStyle = "#d4d4d8"; c.fillText(pn, left ? 42 : W - 42, 68);
    for (let k = 0; k < 2; k++) { c.fillStyle = k < m.w[i] ? "#facc15" : "#3f3f46"; c.beginPath(); c.arc(left ? 54 + k * 20 : W - 54 - k * 20, 84, 6, 0, 6.283); c.fill(); }
    if (f.cb > 1) { c.fillStyle = "#fb923c"; c.textAlign = left ? "left" : "right"; c.font = "bold 22px Impact,Arial Black,sans-serif"; c.fillText(f.cb + " ХІТІВ!", left ? 40 : W - 40, 116); }
  }
  c.textAlign = "center"; c.fillStyle = "#facc15"; c.font = "bold 34px Impact,Arial Black,sans-serif"; c.fillText(String(Math.max(0, m.tm)).padStart(2, "0"), W / 2, 54);
  c.font = "12px Arial"; c.fillStyle = "#a1a1aa"; c.fillText("РАУНД " + m.rd, W / 2, 72);
  if (m.bn) { fit(m.bn, 840, 54); c.textAlign = "center"; c.fillStyle = "#000"; c.fillText(m.bn, W / 2 + 3, 203); c.fillStyle = "#ef4444"; c.fillText(m.bn, W / 2, 200); }
  c.textAlign = "right"; c.font = "bold 12px Arial"; const ms = Math.round(rtt); c.fillStyle = ms < 80 ? "#4ade80" : ms < 160 ? "#facc15" : "#f87171"; c.fillText("● " + ms + " мс", W - 10, H - 6);
  if (pauseInfo) {
    c.fillStyle = "rgba(5,4,10,.72)"; c.fillRect(0, 0, W, H); c.textAlign = "center"; c.fillStyle = "#fff"; c.font = "bold 34px Impact,Arial Black,sans-serif";
    const pn = (players[pauseInfo.slot] && players[pauseInfo.slot].name) || "Гравець";
    c.fillText(pauseInfo.slot === me.slot ? "ВИ ВТРАТИЛИ ЗВʼЯЗОК" : pn.toUpperCase() + " ВИПАВ З БОЮ", W / 2, 215);
    c.font = "bold 22px Arial"; c.fillStyle = "#facc15"; c.fillText("Чекаємо повернення: " + pauseInfo.left + " с, далі технічна поразка", W / 2, 260);
  }
}

// ---------- Вид бойца: свой — предсказание, чужой — интерполяция ----------
function viewOf(i, now) {
  const latest = snap.f[i];
  if (imPlayer() && i === mySlotIdx()) {
    const v = Object.assign({}, latest);
    if (pred.x !== null) { v.x = pred.x; v.y = pred.y; }
    if (localActive()) v.at = localAtk.type;
    const cx = predCtx(snap);
    if (cx.free) { if (held.b) v.bl = 1; if (held.d && v.y >= FLOOR - FH - 1) v.cr = 1; }
    return v;
  }
  const it = buf.at(now - INTERP_MS); return it ? it[i] : latest;
}
let lastT = performance.now(), acc = 0;
function frame(nowT) {
  const dt = Math.min(100, nowT - lastT); lastT = nowT; acc += dt; tick++;
  c.save();
  if (shake > 0) { c.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake); shake--; }
  drawArena();
  if (snap && lobby && lobby.chars) {
    if (imPlayer()) { let n = 0; while (acc >= 1000 / 60 && n++ < 5) { pred.step(nowT, held, predCtx(snap)); acc -= 1000 / 60; } if (n >= 5) acc = 0; } else acc = 0;
    snap.pr.forEach(drawProjectile);
    for (let i = 0; i < 2; i++) { const ch = byId(lobby.chars[i]); if (!ch) continue; const v = viewOf(i, nowT); drawFighter(c, ch, v, v.x, v.y, tick); }
    for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.x += p.vx; p.y += p.vy; p.vy += .32; if (--p.life <= 0) { parts.splice(i, 1); continue; } c.fillStyle = p.c; c.fillRect(p.x, p.y, p.s, p.s); }
    drawHUD(snap);
  }
  c.restore(); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- Управление ----------
const held = { l: 0, r: 0, b: 0, d: 0 }; let lastSent = "";
function sendHeld(force) { const s = JSON.stringify(held); if (force || s !== lastSent) { lastSent = s; sendFast({ action: "in", ...held }); } }
const resendHeld = () => sendHeld(true);
function setHold(k, v) { held[k] = v ? 1 : 0; sendHeld(); }
function releaseAll() { held.l = held.r = held.b = held.d = 0; sendHeld(); document.querySelectorAll(".pb.on").forEach(b => b.classList.remove("on")); }
function localAttack(a) { // мгновенная анимация удара до ответа сервера
  if (!snap || !imPlayer()) return;
  const f = snap.f[mySlotIdx()], cx = predCtx(snap);
  if (!cx.free || held.b || localActive() || f.at) return;
  const air = pred.y !== null && pred.y + FH < FLOOR - 2; let type = a, dur;
  if (a === "special") { if (f.cd > 0) return; dur = 300; }
  else if (air) { type = "air"; dur = 333; }
  else if (held.d && a === "punch") { type = "upper"; dur = 367; }
  else if (held.d && a === "kick") { type = "sweep"; dur = 433; }
  else dur = a === "kick" ? 333 : 233;
  localAtk = { type, until: performance.now() + dur };
  snd(a === "special" ? 330 : 210, a === "special" ? "triangle" : "sine", a === "special" ? .22 : .08, .12);
}
function doAct(a) {
  if (a === "jump") { if (snap && imPlayer()) pred.jump(performance.now(), held, predCtx(snap)); }
  else localAttack(a);
  sendFast({ action: "do", a });
}
document.querySelectorAll(".pb").forEach(b => {
  const hold = b.dataset.hold, act = b.dataset.do;
  const down = e => { e.preventDefault(); b.classList.add("on"); try { b.setPointerCapture(e.pointerId); } catch (x) {} hold ? setHold(hold, 1) : doAct(act); };
  const up = e => { e.preventDefault(); b.classList.remove("on"); if (hold) setHold(hold, 0); };
  b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up);
  b.addEventListener("lostpointercapture", up); b.addEventListener("contextmenu", e => e.preventDefault());
});
const KEYS = { KeyA: ["h", "l"], ArrowLeft: ["h", "l"], KeyD: ["h", "r"], ArrowRight: ["h", "r"], KeyS: ["h", "d"], ArrowDown: ["h", "d"],
  KeyB: ["h", "b"], ShiftLeft: ["h", "b"], ShiftRight: ["h", "b"], KeyE: ["h", "b"],
  KeyW: ["d", "jump"], ArrowUp: ["d", "jump"], Space: ["d", "jump"], KeyF: ["d", "punch"], KeyJ: ["d", "punch"], KeyG: ["d", "kick"], KeyK: ["d", "kick"], KeyH: ["d", "special"], KeyL: ["d", "special"] };
addEventListener("keydown", e => { const k = KEYS[e.code]; if (!k || !imPlayer()) return; e.preventDefault(); if (k[0] === "h") setHold(k[1], 1); else if (!e.repeat) doAct(k[1]); });
addEventListener("keyup", e => { const k = KEYS[e.code]; if (k && k[0] === "h") setHold(k[1], 0); });
addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAll(); });

connect();
