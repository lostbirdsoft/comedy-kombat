// COMEDY KOMBAT v0.6 — клиент Mini App. Рисует состояние от сервера (Cloudflare Worker),
// свой боец двигается мгновенно (предсказание), чужой — плавно с небольшой задержкой.
import { Predictor, SnapBuffer } from "./predict.js?v=11";
import { drawFighter } from "./fighter.js?v=11";
import { DEFAULT_ARENA, makeState, loadArena, drawBack, drawFront, cameraTarget, stepCamera } from "./arena.js?v=11";
const IMG_V = new URL(import.meta.url).searchParams.get("v") || "0"; // картинки арен кэшируются по тому же ?v=, что и сам app.js

const CLIENT_VERSION = "0.6.0";
const WORKER_URL = "wss://comedy-kombat.lostbirdsoft.workers.dev";
const W = 900, H = 500, FLOOR = 432, FH = 142, FW = 54, INTERP_MS = 75;

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); try { tg.disableVerticalSwipes?.(); tg.setHeaderColor?.("#0c0a12"); tg.setBackgroundColor?.("#0c0a12"); } catch (e) {} }
const params = new URLSearchParams(location.search);
const startRoom = tg?.initDataUnsafe?.start_param || params.get("room") || ""; // из приглашения; пусто — открыто из профиля бота → главное меню
let roomId = "", botLevel = null, joinOpts = {}, pendingRoom = "", tsToken = "", tsWidget = null;
// Локальный тест без Telegram: ?room=room_test&dev=Імя (нужен ALLOW_DEV="1" на сервере)
const isTg = !!tg && (!!tg.initData || (!!tg.platform && tg.platform !== "unknown")), devName = params.get("dev") || ""; // isTg — игра открыта внутри Telegram (в обычном браузере platform = "unknown")
const isGuestMode = () => !isTg && !devName;                       // обычный браузер: входим как гость (ник + токен от сервера)
function getInitData() { if (tg?.initData) return tg.initData; if (devName) return "dev:" + devName; const t = store.get("ck_guest", ""); return t ? "guest:" + t : ""; }
const $ = id => document.getElementById(id);
const el = { status: $("status"), roomTag: $("roomTag"), resign: $("resignBtn"), wait: $("screenWait"), select: $("screenSelect"),
  fight: $("screenFight"), grid: $("grid"), ready: $("readyBtn"), result: $("result"), rematch: $("rematchBtn"), gear: $("gearBtn") };
const setStatus = t => { el.status.textContent = t; };
if (startRoom && !/^[a-zA-Z0-9_-]{1,50}$/.test(startRoom)) { setStatus("Не вдалося визначити кімнату. Відкрийте запрошення з чату."); throw new Error("bad room"); }
el.menu = $("screenMenu"); el.rooms = $("screenRooms"); el.guest = $("screenGuest");


let arenas = [], arenaSt = null, cam = 0, camSnap = true; const CLUB_ST = makeState(DEFAULT_ARENA);
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

let attempts = 0, reconnectTimer = null;
function connect() {
  clearTimeout(reconnectTimer);
  if (!roomId) return; // в главном меню соединение не нужно
  if (ws && ws.readyState <= 1) return; // уже подключаемся или подключены
  setStatus(attempts ? "Підключаємось… (спроба " + (attempts + 1) + ")" : "Підключаємось…");
  let opened = false;
  const sock = new WebSocket(WORKER_URL.replace(/\/$/, "") + "/ws?room=" + encodeURIComponent(roomId)); ws = sock;
  sock.onopen = async () => {
    opened = true;
    try {
      const r = await call("join", { initData: getInitData(), level: botLevel, create: !!joinOpts.create, public: !!joinOpts.public });
      attempts = 0; joinOpts = {};
      me = { slot: r.player, spectator: !!r.spectator }; roster = r.roster; camps = r.camps; arenas = r.arenas || []; players = r.players;
      buildGrid(); buildArenaRow(); setStatus(me.spectator ? "Ви спостерігач 👀" : "Ви — гравець " + me.slot);
      resendHeld(); render();
    } catch (e) {
      if (e.code === "not_found") { stopConnection(); showRooms(e.message); }
      else if (e.code === "auth" && isGuestMode()) { stopConnection(); store.set("ck_guest", ""); pendingRoom = roomId.startsWith("room_bot_") ? "" : roomId; showGuest(e.message); } // токен гостя недійсний/застарів
      else if (e.code === "rate_limited") { const bot = roomId.startsWith("room_bot_"); stopConnection(); if (bot) showMenu(); else showRooms(); setStatus(e.message); }
      else setStatus(e.message);
    }
  };
  sock.onmessage = ev => {
    if (ev.data === "pong") { if (pingSent) rtt = rtt * 0.7 + (performance.now() - pingSent) * 0.3; return; }
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.type === "lobby") { lobby = m; players = m.players; syncArena(); if (m.status !== "active") pauseInfo = null; if (m.status === "select" || m.status === "waiting") snap = null; render(); }
    else if (m.type === "snap") onSnap(m);
    else if (m.type === "pause") pauseInfo = m.slot ? { slot: m.slot, left: m.left } : null;
    else if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m) : p.reject(Object.assign(new Error(m.error || "Помилка"), { code: m.code })); }
  };
  let handled = false;
  const fail = code => { // ошибка, закрытие или зависание подключения — всё сводится к одному планировщику переподключения
    if (handled || sock !== ws) return; handled = true; clearTimeout(connTimeout); try { sock.close(); } catch (e) {}
    attempts++; // пауза между попытками растёт: 1,2 → 1,9 → 3 → 5 → 8 → … до 15 с, чтобы не долбить сервер
    const delay = Math.min(15000, Math.round(1200 * Math.pow(1.6, attempts - 1))), sec = Math.round(delay / 1000);
    setStatus(opened ? "Звʼязок втрачено. Перепідключення за " + sec + " с…"
      : "Сервер не відповідає (код " + code + "). Нова спроба за " + sec + " с" + (attempts >= 3 ? ". Якщо не минає — напиши розробнику." : ""));
    reconnectTimer = setTimeout(connect, delay);
  };
  const connTimeout = setTimeout(() => { if (!opened) fail(0); }, 10000);
  sock.onerror = () => fail(1006);
  sock.onclose = ev => fail(ev.code);
}
// Вернулся в приложение (разблокировал телефон, переключился из другого чата) — подключаемся сразу, без ожидания.
document.addEventListener("visibilitychange", () => { if (roomId && !document.hidden && (!ws || ws.readyState > 1)) { attempts = 0; connect(); } });

// ---------- Экраны ----------
const show = name => { for (const k of ["guest", "menu", "rooms", "wait", "select", "fight"]) el[k].hidden = k !== name; };
function render() {
  if (!roomId || !lobby || !roster.length) return;
  const st = lobby.status;
  $("menuBtn").hidden = st === "active" && imPlayer(); // посреди боя выйти можно только через «Здатися»
  try { st === "active" && imPlayer() ? tg?.enableClosingConfirmation?.() : tg?.disableClosingConfirmation?.(); } catch (e) {}
  el.resign.hidden = !(st === "active" && imPlayer());
  if (st === "waiting") { show("wait"); updateShare(); return; }
  if (st === "select") { show("select"); renderSelect(); return; }
  show("fight");
  $("controls").hidden = !imPlayer() || st === "finished";
  if (imPlayer() && lobby.chars) { const ch = byId(lobby.chars[mySlotIdx()]); if (ch) $("specName").textContent = ch.special.name.split(" ").slice(0, 2).join(" "); }
  if (st === "finished") {
    const w = lobby.winner, wc = lobby.chars && byId(lobby.chars[w - 1]), wname = (players[w] && players[w].name) || "Боєць";
    $("resTitle").textContent = imPlayer() ? (w === me.slot ? "🏆 ПЕРЕМОГА!" : "💀 ПОРАЗКА") : "🏆 " + wname;
    $("resSub").textContent = (imPlayer() ? wname + (wc ? " (" + wc.name + ")" : "") : (wc ? wc.name : "")) + (lobby.reason ? " · " + lobby.reason : "");
    el.rematch.hidden = me.spectator;
    const voted = lobby.rematch && lobby.rematch[me.slot], vsBot = !!(players[2] && players[2].bot);
    el.rematch.disabled = !!voted; el.rematch.textContent = voted ? "ЧЕКАЄМО СУПЕРНИКА…" : (vsBot ? "ЩЕ РАЗ" : "РЕВАНШ");
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
function arenaCfg(id) { return arenas.find(a => a.id === id) || DEFAULT_ARENA; }
function syncArena() { // арена выбрана хостом; грузим её картинки заранее, пока игроки выбирают бойцов
  const id = lobby && lobby.arena; if (!id || !arenas.length) return;
  if (!arenaSt || arenaSt.cfg.id !== id) { arenaSt = loadArena(arenaCfg(id), "img/arenas/", IMG_V); camSnap = true; }
}
function buildArenaRow() {
  const row = $("arenaRow"); row.innerHTML = "";
  const mk = (id, emoji, name) => { const b = document.createElement("button"); b.className = "chip"; b.dataset.id = id; const e = document.createElement("b"); e.textContent = emoji; const n = document.createElement("span"); n.textContent = name; b.appendChild(e); b.appendChild(n); b.onclick = () => pickArena(id); row.appendChild(b); };
  arenas.forEach(a => mk(a.id, a.emoji, a.name)); mk("random", "🎲", "Інша випадкова");
}
async function pickArena(id) { if (me.slot !== 1 || me.spectator) return; try { await call("arena", { arena: id }); } catch (e) { setStatus(e.message); } }
function renderArenaRow() {
  const host = me.slot === 1 && !me.spectator, cur = lobby.arena, a = arenaCfg(cur), hostName = (players[1] && players[1].name) || "перший гравець";
  [...$("arenaRow").children].forEach(b => { b.classList.toggle("sel", b.dataset.id === cur); b.disabled = !host; });
  $("arenaDesc").textContent = (a.desc || "") + (a.worldW > 900 ? " ↔ Рівень з прокруткою." : "") + (host ? "" : " Арену обирає " + hostName + ".");
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
  $("vsLine").textContent = me.spectator ? "Гравці обирають бійців…" : (lobby.locked && lobby.locked[opp] ? on + " вже готовий!" : on + " обирає бійця…");
  renderArenaRow();
  el.ready.disabled = me.spectator || !mine || !!locked; el.ready.textContent = locked ? "ЧЕКАЄМО СУПЕРНИКА…" : "ОБРАТИ БІЙЦЯ";
}
el.ready.onclick = async () => { try { await call("ready"); } catch (e) { setStatus(e.message); } };
el.rematch.onclick = async () => { try { await call("rematch"); } catch (e) { setStatus(e.message); } };
el.resign.onclick = async () => { if (confirm("Здатися?")) { try { await call("resign"); } catch (e) { setStatus(e.message); } } };

// ---------- Звук (синтез, без файлов; iOS: разблокировка по первому касанию) ----------
const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
let actx = null, soundOn = store.get("ck_sound", "1") !== "0", hapticOn = store.get("ck_haptic", "1") !== "0";
let ctrlMode = store.get("ck_ctrl", "joystick") === "buttons" ? "buttons" : "joystick"; // по умолчанию джойстик
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
const haptic = (k = "medium") => { if (!hapticOn) return; try { tg?.HapticFeedback?.impactOccurred(k); } catch (e) {} };

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
  return { free: m.ph === "fight" && !f.st && !f.fr && !f.dd && !f.kd, busy: !!f.at || localActive(), speed: st.speed, jumpV: st.jump, worldW: arenaSt ? arenaSt.cfg.worldW : 900, oppX: m.f[1 - mySlotIdx()].x };
}
const localActive = () => localAtk && performance.now() < localAtk.until;
function onSnap(m) {
  const now = performance.now(); snap = m; buf.push(now, m);
  if (imPlayer()) {
    if (m.rd !== lastRd || (m.ph === "intro" && lastPh !== "intro")) { pred.reset(); camSnap = true; }
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

// ---------- Арена, снаряды, HUD ----------
let tick = 0;
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
  const st = arenaSt || CLUB_ST; let views = null;
  if (snap && lobby && lobby.chars) {
    if (imPlayer()) { let n = 0; while (acc >= 1000 / 60 && n++ < 5) { pred.step(nowT, held, predCtx(snap)); acc -= 1000 / 60; } if (n >= 5) acc = 0; } else acc = 0;
    views = [viewOf(0, nowT), viewOf(1, nowT)];
    const tgt = cameraTarget(views[0].x, views[1].x, st.cfg.worldW); cam = camSnap ? tgt : stepCamera(cam, tgt); camSnap = false; // камера следует за серединой между бойцами
  } else { cam = 0; camSnap = true; }
  drawBack(c, st, cam, tick);
  if (views) {
    c.save(); c.translate(-Math.round(cam), 0); // всё игровое рисуется в координатах мира
    snap.pr.forEach(drawProjectile);
    for (let i = 0; i < 2; i++) { const ch = byId(lobby.chars[i]); if (ch) drawFighter(c, ch, views[i], views[i].x, views[i].y, tick); }
    for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.x += p.vx; p.y += p.vy; p.vy += .32; if (--p.life <= 0) { parts.splice(i, 1); continue; } c.fillStyle = p.c; c.fillRect(p.x, p.y, p.s, p.s); }
    c.restore();
    drawFront(c, st, cam, tick); drawHUD(snap); // передний план поверх бойцов, затем интерфейс на экране
  }
  c.restore(); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- Управление ----------
const held = { l: 0, r: 0, b: 0, d: 0 }; let lastSent = "";
function sendHeld(force) { const s = JSON.stringify(held); if (force || s !== lastSent) { lastSent = s; sendFast({ action: "in", ...held }); } }
const resendHeld = () => sendHeld(true);
function setHold(k, v) { held[k] = v ? 1 : 0; sendHeld(); }
function releaseAll() { held.l = held.r = held.b = held.d = 0; sendHeld(); joyReset(); document.querySelectorAll(".pb.on").forEach(b => b.classList.remove("on")); }
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

// ---------- Джойстик ----------
// Круг слева: тянешь влево/вправо — идёшь, вверх — прыжок, вниз — присед. Диагонали работают (бег + прыжок).
const joy = $("joy"), knob = $("joyKnob"); let joyId = null, jumpArmed = true;
function applyHeld(l, r, d) { held.l = l ? 1 : 0; held.r = r ? 1 : 0; held.d = d ? 1 : 0; sendHeld(); }
function joyReset() { joyId = null; jumpArmed = true; knob.style.transform = "translate(0px,0px)"; joy.classList.remove("active"); applyHeld(0, 0, 0); }
function joyMove(e) {
  const r = joy.getBoundingClientRect(), R = r.width / 2, maxR = R * 0.62;
  const dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R), dist = Math.hypot(dx, dy), k = dist > maxR ? maxR / dist : 1;
  knob.style.transform = "translate(" + dx * k + "px," + dy * k + "px)";
  const nx = dx / maxR, ny = dy / maxR;
  const down = ny > 0.55 && ny > Math.abs(nx);                     // «в основном вниз» — присесть
  applyHeld(nx < -0.3, nx > 0.3, down);
  if (ny < -0.6) { if (jumpArmed) { jumpArmed = false; doAct("jump"); } } else if (ny > -0.3) jumpArmed = true; // прыжок один раз за выброс вверх
}
joy.addEventListener("pointerdown", e => { e.preventDefault(); if (joyId !== null) return; joyId = e.pointerId; joy.classList.add("active"); try { joy.setPointerCapture(e.pointerId); } catch (x) {} joyMove(e); });
joy.addEventListener("pointermove", e => { if (e.pointerId === joyId) { e.preventDefault(); joyMove(e); } });
const joyEnd = e => { if (e.pointerId === joyId) joyReset(); };
joy.addEventListener("pointerup", joyEnd); joy.addEventListener("pointercancel", joyEnd); joy.addEventListener("lostpointercapture", joyEnd);
joy.addEventListener("contextmenu", e => e.preventDefault());

// ---------- Настройки (⚙️) ----------
const settings = $("settings"), seg = [...document.querySelectorAll("#segControl button")];
const NOTES = { joystick: "Тяни круг: влево/вправо — идти, вверх — прыжок, вниз — присесть. Диагональ вверх-вправо — прыжок вперёд.", buttons: "Классическая крестовина: ◀ ▶ идти, ▲ прыжок, ▼ присесть." };
function applyControl() {
  releaseAll();
  $("joy").hidden = ctrlMode !== "joystick"; $("dpad").hidden = ctrlMode !== "buttons";
  seg.forEach(b => b.classList.toggle("sel", b.dataset.v === ctrlMode)); $("ctrlNote").textContent = NOTES[ctrlMode];
}
function paintToggles() {
  const s = $("togSound"), h = $("togHaptic");
  s.textContent = soundOn ? "УВІМК" : "ВИМК"; s.classList.toggle("on", soundOn);
  h.textContent = hapticOn ? "УВІМК" : "ВИМК"; h.classList.toggle("on", hapticOn);
}
seg.forEach(b => { b.onclick = () => { ctrlMode = b.dataset.v; store.set("ck_ctrl", ctrlMode); applyControl(); }; });
$("togSound").onclick = () => { soundOn = !soundOn; store.set("ck_sound", soundOn ? "1" : "0"); paintToggles(); unlockAudio(); if (soundOn) snd(440, "triangle", .12, .12); };
$("togHaptic").onclick = () => { hapticOn = !hapticOn; store.set("ck_haptic", hapticOn ? "1" : "0"); paintToggles(); if (hapticOn) haptic("medium"); };
el.gear.onclick = () => { releaseAll(); $("nickRow").hidden = !isGuestMode() || !!roomId; $("nickName").textContent = store.get("ck_guest_name", ""); $("verNote").textContent = "Версія клієнта " + CLIENT_VERSION + (roomId ? " · кімната " + roomId.slice(-6).toUpperCase() : ""); settings.hidden = false; };
$("settingsClose").onclick = () => { settings.hidden = true; };
settings.addEventListener("pointerdown", e => { if (e.target === settings) settings.hidden = true; });
applyControl(); paintToggles();

// ---------- Главное меню и вход в комнату ----------
function resetState() {
  me = { slot: 0, spectator: false }; roster = []; players = {}; lobby = null; snap = null; picked = null; pauseInfo = null; localAtk = null;
  buf.b.length = 0; pred.reset(); parts.length = 0; lastRd = 0; lastPh = ""; arenaSt = null; cam = 0; camSnap = true; el.result.hidden = true; releaseAll();
}
function sendLeave() { try { if (ws && ws.readyState === 1 && imPlayer()) ws.send(JSON.stringify({ action: "leave" })); } catch (e) {} } // освободить место (во время боя сервер откажет)
function stopConnection() { clearTimeout(reconnectTimer); const s = ws; ws = null; attempts = 0; pending.clear(); if (s) setTimeout(() => { try { s.close(); } catch (e) {} }, 120); }
function setBack(on) { try { if (tg?.BackButton) on ? tg.BackButton.show() : tg.BackButton.hide(); } catch (e) {} }
function enterRoom(id, level, opts) {
  stopConnection(); resetState(); roomId = id; botLevel = level || null; joinOpts = opts || {};
  el.roomTag.textContent = id.startsWith("room_bot_") ? "VS КОМП" : id.startsWith("room_c_") ? "КОД " + id.slice(7) : id.slice(-6).toUpperCase();
  $("menuBtn").hidden = false; el.resign.hidden = true; show("wait"); updateShare(); setBack(true); connect();
}
function showMenu() {
  sendLeave(); stopConnection(); resetState(); roomId = ""; botLevel = null; clearInterval(lobbyTimer);
  $("menuMain").hidden = false; $("menuLevels").hidden = true; show("menu");
  $("menuWho").hidden = !isGuestMode(); $("menuWho").textContent = "👤 " + store.get("ck_guest_name", "");
  $("menuBtn").hidden = true; el.resign.hidden = true; el.roomTag.textContent = "МЕНЮ"; setStatus("Обери режим"); setBack(false);
  try { tg?.disableClosingConfirmation?.(); } catch (e) {}
}
function showRooms(msg) {
  sendLeave(); stopConnection(); resetState(); roomId = ""; botLevel = null;
  show("rooms"); $("menuBtn").hidden = true; el.resign.hidden = true; el.roomTag.textContent = "КІМНАТИ"; setBack(true);
  setStatus(msg || "Створи кімнату, введи код або обери з лобі"); loadLobby(); startLobbyPoll();
  try { tg?.disableClosingConfirmation?.(); } catch (e) {}
}
async function leaveToMenu() {
  if (!roomId) { showMenu(); return; } // экран «Кімнати» → назад в меню
  if (lobby && lobby.status === "active" && imPlayer()) { if (!confirm("Здатися і вийти в меню?")) return; try { await call("resign"); } catch (e) {} }
  showMenu();
}
const newId = () => { const a = new Uint8Array(8); try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < 8; i++) a[i] = Math.random() * 256; } return Array.from(a, b => b.toString(36).padStart(2, "0")).join("").slice(0, 12); };
$("btnBot").onclick = () => { $("menuMain").hidden = true; $("menuLevels").hidden = false; setStatus("Обери складність"); };
$("btnLevelsBack").onclick = () => { $("menuMain").hidden = false; $("menuLevels").hidden = true; setStatus("Обери режим"); };
document.querySelectorAll(".lvl").forEach(b => { b.onclick = () => enterRoom("room_bot_" + newId(), b.dataset.level); });
$("menuBtn").onclick = leaveToMenu; $("menuBtn2").onclick = showMenu;
try { tg?.BackButton?.onClick(leaveToMenu); } catch (e) {}

// ---------- Кімнати: создать, войти по коду, лобби ----------
const HTTP_BASE = WORKER_URL.replace(/^ws/, "http").replace(/\/$/, "");
const CODE_AL = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // без 0/O, 1/I/L — чтобы код не путали при диктовке
const cleanCode = t => [...String(t).toUpperCase()].filter(ch => CODE_AL.includes(ch)).join("").slice(0, 5);
function newCode() { const a = new Uint8Array(5); try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < 5; i++) a[i] = Math.random() * 256; } return Array.from(a, b => CODE_AL[b % CODE_AL.length]).join(""); }
function createRoom(pub) { enterRoom("room_c_" + newCode(), null, { create: true, public: pub }); }
function joinByCode() {
  const code = cleanCode($("codeInput").value);
  if (code.length !== 5) { setStatus("Код має 5 символів (літери та цифри, без 0, 1, O, I, L)."); return; }
  enterRoom("room_c_" + code);
}
function updateShare() { // на экране ожидания в своей комнате показываем код и кнопки «скопировать / отправить»
  const custom = roomId.startsWith("room_c_");
  $("btnCopyWeb").hidden = !(custom && isTg);
  $("shareLabel").textContent = isTg ? "📨 НАДІСЛАТИ ЗАПРОШЕННЯ" : "📨 ПОДІЛИТИСЬ ПОСИЛАННЯМ";
  $("shareSub").textContent = isTg ? "Відкриє вибір чату в Telegram" : "Посилання відкриється в браузері друга";
  $("roomShare").hidden = !custom; $("waitHint").textContent = custom ? "Надішли код або запрошення другові" : "Надішли друзям кнопку з чату";
  if (custom) $("roomCode").textContent = roomId.slice(7);
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {}
  try { const ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); document.body.removeChild(ta); return ok; } catch (e) { return false; }
}
let botName; async function getBot() { if (botName !== undefined) return botName; try { const j = await (await fetch(HTTP_BASE + "/info")).json(); botName = j.bot || null; } catch (e) { botName = null; } return botName; }
$("btnCopyCode").onclick = async () => { const code = roomId.slice(7), ok = await copyText(code); setStatus(ok ? "Код скопійовано ✓" : "Не вдалося скопіювати. Код: " + code); };
const webLink = () => location.origin + location.pathname + "?room=" + roomId; // ссылка для браузера (без Telegram)
$("btnCopyWeb").onclick = async () => { const l = webLink(), ok = await copyText(l); setStatus(ok ? "Посилання скопійовано ✓" : "Не вдалося скопіювати: " + l); };
$("btnShareLink").onclick = async () => {
  if (!isTg) { // браузер: системное меню «Поделиться» или копирование ссылки
    const l = webLink(), t = "Зіграємо в Comedy Kombat? Код кімнати: " + roomId.slice(7);
    try { if (navigator.share) { await navigator.share({ title: "Comedy Kombat", text: t, url: l }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
    const ok = await copyText(l); setStatus(ok ? "Посилання скопійовано ✓" : "Посилання: " + l); return;
  }
  const code = roomId.slice(7), bot = await getBot();
  if (!bot) { const ok = await copyText(code); setStatus("Посилання зараз недоступне. " + (ok ? "Код скопійовано: " : "Код: ") + code); return; }
  const link = "https://t.me/" + bot + "?startapp=" + roomId, text = "Зіграємо в Comedy Kombat? Код кімнати: " + code;
  const url = "https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent(text);
  try { if (tg?.openTelegramLink) tg.openTelegramLink(url); else window.open(url, "_blank"); } catch (e) { await copyText(link); setStatus("Посилання скопійовано: " + link); }
};
const ago = sec => sec < 45 ? "щойно" : Math.round(sec / 60) + " хв тому";
let lobbyTimer = null;
function startLobbyPoll() { clearInterval(lobbyTimer); lobbyTimer = setInterval(() => { if (el.rooms.hidden) clearInterval(lobbyTimer); else loadLobby(); }, 5000); }
async function loadLobby() {
  const list = $("lobbyList"), note = t => { list.innerHTML = ""; const d = document.createElement("div"); d.className = "lobby-empty"; d.textContent = t; list.appendChild(d); };
  try {
    const j = await (await fetch(HTTP_BASE + "/lobby", { cache: "no-store" })).json();
    if (el.rooms.hidden) return;
    if (!j.rooms.length) { note("Поки нікого. Створи відкриту кімнату, і вона зʼявиться тут."); return; }
    list.innerHTML = "";
    j.rooms.forEach(rm => {
      const row = document.createElement("div"); row.className = "lobby-row";
      const info = document.createElement("div"), b = document.createElement("b"), sm = document.createElement("small");
      b.textContent = "🎤 " + rm.host; sm.textContent = "код " + rm.code + " · " + ago(rm.age); info.appendChild(b); info.appendChild(sm);
      const go = document.createElement("button"); go.className = "lobby-go"; go.textContent = "У БІЙ";
      row.appendChild(info); row.appendChild(go); row.onclick = () => enterRoom(rm.id); list.appendChild(row);
    });
  } catch (e) { if (!el.rooms.hidden) note("Не вдалося завантажити лобі. Спробуй ще раз."); }
}
$("btnRooms").onclick = () => showRooms();
$("btnCreatePublic").onclick = () => createRoom(true); $("btnCreatePrivate").onclick = () => createRoom(false);
$("btnJoinCode").onclick = joinByCode; $("btnRoomsBack").onclick = showMenu; $("btnLobbyRefresh").onclick = loadLobby;
$("codeInput").oninput = () => { $("codeInput").value = cleanCode($("codeInput").value); };
$("codeInput").onkeydown = e => { if (e.key === "Enter") joinByCode(); };


// ---------- Гостевой вход (без Telegram) ----------
const cleanName = t => String(t).replace(/[^\p{L}\p{N} _.\-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 20);
function showGuest(msg) {
  sendLeave(); stopConnection(); resetState(); roomId = ""; botLevel = null; clearInterval(lobbyTimer);
  show("guest"); $("menuBtn").hidden = true; el.resign.hidden = true; el.roomTag.textContent = "ВХІД"; setBack(false);
  $("guestName").value = store.get("ck_guest_name", ""); setStatus(msg || "Як тебе звати?"); setupCaptcha();
}
function afterLogin() { if (pendingRoom) { const r = pendingRoom; pendingRoom = ""; enterRoom(r); } else showMenu(); }
function loadTurnstile() { return new Promise((res, rej) => { if (window.turnstile) return res(); const sc = document.createElement("script"); sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; sc.async = true; sc.onload = () => res(); sc.onerror = () => rej(new Error("turnstile")); document.head.appendChild(sc); }); }
async function setupCaptcha() { // капча (Turnstile) включается на сервере; если ключа нет — ничего не показываем
  const box = $("tsBox"); box.hidden = true; tsToken = ""; $("btnGuestGo").disabled = false;
  if (store.get("ck_guest", "")) return; // уже есть личность: смена ника без капчи
  let key = ""; try { key = (await (await fetch(HTTP_BASE + "/config")).json()).turnstileSiteKey || ""; } catch (e) { return; }
  if (!key) return;
  try { await loadTurnstile(); } catch (e) { setStatus("Не вдалося завантажити перевірку. Оновіть сторінку."); return; }
  box.hidden = false; $("btnGuestGo").disabled = true;
  if (tsWidget !== null) { window.turnstile.reset(tsWidget); return; }
  tsWidget = window.turnstile.render(box, { sitekey: key, callback: t => { tsToken = t; $("btnGuestGo").disabled = false; }, "expired-callback": () => { tsToken = ""; $("btnGuestGo").disabled = true; }, "error-callback": () => setStatus("Помилка перевірки. Спробуйте ще раз.") });
}
async function guestLogin() {
  const name = cleanName($("guestName").value), btn = $("btnGuestGo");
  if (name.length < 2) { setStatus("Нікнейм: від 2 до 20 символів."); return; }
  btn.disabled = true; setStatus("Входимо…");
  try {
    const r = await fetch(HTTP_BASE + "/guest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, token: store.get("ck_guest", ""), cf: tsToken }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const err = new Error(j.error || "Не вдалося увійти. Спробуйте ще раз."); err.code = j.code; throw err; }
    store.set("ck_guest", j.token); store.set("ck_guest_name", j.name); btn.disabled = false; afterLogin();
  } catch (e) {
    setStatus(e.message || "Немає зʼєднання з сервером.");
    if (e.code === "captcha") { store.set("ck_guest", ""); setupCaptcha(); } else btn.disabled = false;
  }
}
$("btnGuestGo").onclick = guestLogin;
$("guestName").onkeydown = e => { if (e.key === "Enter") guestLogin(); };
$("btnChangeNick").onclick = () => { settings.hidden = true; pendingRoom = ""; showGuest("Зміни нікнейм"); };

function startApp() {
  if (isGuestMode() && !store.get("ck_guest", "")) { pendingRoom = startRoom; showGuest(); return; } // без Telegram і без профілю — спершу нікнейм
  if (startRoom) enterRoom(startRoom); else showMenu();
}
startApp();
// Установка как приложения (только в обычном браузере; кэша нет, обновления приходят сразу)
try { if ("serviceWorker" in navigator && !isTg && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {}); } catch (e) {}
