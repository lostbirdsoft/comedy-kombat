// sprites.js — СТАНДАРТ СПРАЙТОВ БОЙЦОВ (v0.7.0): каталог состояний, выбор состояния по снимку боя, загрузка полос кадров, рисование.
// Единственный источник правды для игры, tools/sprites.mjs (заглушки, упаковка, проверка), sprite-viewer.html и SPRITES.md.
// Нет картинок у бойца → игра рисует прежнего процедурного бойца (fighter.js); нет отдельного состояния → цепочка запасных (fb) → процедурный кадр.
import { FLOOR, FH, FW, drawStatus } from "./fighter.js?v=16";
import { keyMagenta } from "./arena.js?v=16";
export { drawStatus };

// ---------- геометрия стандарта ----------
export const CELL_W = 256, CELL_H = 224; // клетка кадра, px: 256×224 (запас вправо под удары: подсечка, сильная нога, молот; запас вверх под руки над головой и кувырок). Полоса состояния = N клеток в ряд: ширина 256×N, высота 224
export const STAND_H = 160;         // высота бойца в стойке (макушка → пятки) в px клетки; игра масштабирует так, чтобы это = рост хитбокса (142)
export const ANCHOR = [96, 212];    // точка пола: между стопами; 96 px слева (хватает на лежачее тело), 160 px справа (удары), 212 из 224 по Y (12 px воздуха под ногами, 52 px над головой)
export const FORMAT = 1;            // версия формата fighter.json
// Рисунок смотрит ВПРАВО. Игра сама отражает бойца, когда он смотрит влево.

// ---------- категории (из твоего списка «типы спрайтов») ----------
export const CATEGORIES = {
  stance: "Fighting Stance", victory: "Victory Pose", walking: "Walking", running: "Running", duck_jump: "Ducking & Jumping",
  punching: "Punching", kicking: "Kicking", combos: "Combos (Close Hits)", blocking: "Blocking", throwing: "Throwing",
  hit: "Being Hit", falling: "Falling & Getting Up", dizzy: "Dizzy", special: "Special Moves", finishers: "Finishers",
  parts: "Body Parts", other: "Other"
};

// ---------- каталог состояний ----------
// [id, имя из MK3-списка, категория, уровень, рекоменд. кадров, loop|once, темп, запасные]
//  уровень: 1 = движок использует уже сейчас; 2 = подключается через запасные/новые признаки; 3 = зарезервировано (в бою пока не вызывается)
//  темп: для loop — кадров/с; для once — длительность всей анимации в мс (под реальную длину действия в sim.js)
//  запасные: если файла состояния нет, берётся первое существующее из списка
const T = (id, name, cat, tier, frames, kind, rate, fb = []) => ({ id, name, cat, tier, frames, loop: kind === "loop", rate, fb });
export const STATES = [
  // GENERAL
  T("stance_1", "Stance 1", "stance", 1, 6, "loop", 8),
  T("stance_2", "Stance 2", "stance", 3, 6, "loop", 8, ["stance_1"]),
  T("turn", "Turn", "stance", 2, 3, "once", 150, ["stance_1"]),
  T("walk", "Walk", "walking", 1, 8, "loop", 12, ["stance_1"]),
  T("walk_back", "Walk Back", "walking", 1, 8, "loop", 12, ["walk", "stance_1"]),
  T("crouch", "Crouch", "duck_jump", 1, 3, "once", 120, ["stance_1"]),
  T("crouch_block", "Crouch Block", "blocking", 1, 2, "once", 100, ["crouch", "block", "stance_1"]),
  T("crouch_hit", "Crouch Hit", "hit", 2, 2, "once", 250, ["hit_low", "hit_high", "crouch"]),
  T("crouch_turn", "Crouch Turn", "duck_jump", 3, 2, "once", 120, ["crouch"]),
  T("crouch_lp", "Crouch LP", "punching", 3, 3, "once", 233, ["crouch_hp", "lp"]),
  T("run", "Run", "running", 2, 6, "loop", 14, ["walk", "stance_1"]),
  T("block", "Block", "blocking", 1, 2, "once", 100, ["stance_1"]),
  T("jump_1", "Jump 1", "duck_jump", 1, 6, "once", 750, ["stance_1"]),
  T("jump_2", "Jump 2", "duck_jump", 1, 8, "once", 750, ["jump_1", "stance_1"]),
  T("hit_high", "Being Hit High", "hit", 1, 3, "once", 250, ["stance_1"]),
  T("hit_low", "Being Hit Low", "hit", 2, 3, "once", 250, ["hit_high", "stance_1"]),
  T("slipping", "Slipping", "hit", 3, 4, "once", 400, ["falling", "hit_high"]),
  T("dizzy", "Dizzy", "dizzy", 2, 6, "loop", 8, ["hit_high", "stance_1"]),
  T("falling", "Falling", "falling", 1, 6, "once", 450, ["hit_high", "stance_1"]),
  T("falling_2", "Falling 2", "falling", 3, 6, "once", 450, ["falling"]),
  T("swept", "Swept", "falling", 2, 6, "once", 500, ["falling"]),
  T("getting_up", "Getting Up", "falling", 1, 5, "once", 420, ["crouch", "stance_1"]),
  T("getting_up_2", "Getting Up 2", "falling", 3, 5, "once", 420, ["getting_up"]),
  T("thrown", "Being Thrown", "throwing", 3, 6, "once", 500, ["falling"]),
  T("win_a", "Win A", "victory", 1, 6, "once", 900, ["stance_1"]),
  T("win_b", "Win B", "victory", 3, 6, "once", 900, ["win_a"]),
  T("win_c", "Win C", "victory", 3, 6, "once", 900, ["win_a"]),
  T("faint", "Faint", "falling", 1, 5, "once", 600, ["falling", "hit_high"]),
  T("scared", "Scared", "other", 3, 4, "loop", 8, ["stance_1"]),
  T("blown_away", "Blown Away", "other", 3, 5, "once", 500, ["falling"]),
  T("big_head", "Big Head", "other", 3, 2, "loop", 6, ["stance_1"]),
  T("standing", "Standing", "other", 3, 2, "loop", 6, ["stance_1"]),
  T("sucked", "Sucked", "other", 3, 4, "once", 500, ["hit_high"]),
  T("stretched", "Stretched", "other", 3, 4, "once", 500, ["hit_high"]),
  T("body_parts", "Body Parts", "parts", 3, 6, "once", 600, []),
  T("big_mouth", "Big Mouth", "other", 3, 3, "once", 500, ["stance_1"]),
  T("electrocuted", "Electrocuted", "other", 3, 4, "loop", 14, ["hit_high"]),
  // ATTACKS
  T("crouch_lk", "Crouch LK", "kicking", 3, 3, "once", 220, ["crouch_hk", "lk"]),
  T("crouch_hk", "Crouch HK", "kicking", 1, 5, "once", 430, ["lk", "stance_1"]),            // подсечка (sweep)
  T("crouch_hp", "Crouch HP", "punching", 1, 4, "once", 370, ["hp", "lp", "stance_1"]),     // апперкот (upper)
  T("hp", "HP", "punching", 1, 5, "once", 367, ["lp", "stance_1"]),
  T("lp", "LP", "punching", 1, 3, "once", 233, ["stance_1"]),                                // удар рукой (punch)
  T("close_p", "Close P", "combos", 2, 3, "once", 233, ["lp"]),
  T("lk", "LK", "kicking", 1, 4, "once", 333, ["lp", "stance_1"]),                     // удар ногой (kick)
  T("hk", "HK", "kicking", 1, 5, "once", 500, ["lk", "stance_1"]),
  T("close_k", "Close K", "combos", 2, 4, "once", 333, ["lk"]),
  T("back_lk", "Back LK", "kicking", 3, 4, "once", 333, ["lk"]),
  T("back_hk", "Back HK", "kicking", 3, 5, "once", 400, ["hk", "lk"]),
  T("jump_k_1", "Jump K 1", "kicking", 1, 4, "once", 333, ["jump_1", "lk"]),                 // удар ногой в прыжке (air)
  T("jump_p", "Jump P", "punching", 3, 3, "once", 300, ["jump_k_1", "jump_1"]),
  T("jump_k_2", "Jump K 2", "kicking", 3, 4, "once", 333, ["jump_k_1"]),
  T("throw", "Throw", "throwing", 3, 6, "once", 600, ["close_p", "lp"]),
  T("special_a", "Special A", "special", 1, 5, "once", 300, ["lp", "stance_1"]),             // projectile
  T("special_b", "Special B", "special", 1, 5, "once", 300, ["special_a", "lp"]),            // shockwave
  T("special_c1", "Special C1", "special", 1, 6, "loop", 16, ["jump_k_1", "lk"]),            // dash (ядро)
  T("special_c2", "Special C2", "special", 3, 4, "once", 300, ["special_c1"]),
  T("special_d1", "Special D1", "special", 1, 6, "once", 400, ["special_a", "lp"]),          // teleport
  T("special_e1", "Special E1", "special", 1, 8, "once", 530, ["hp", "lp", "stance_1"]),     // smash
  T("special_e2", "Special E2", "special", 3, 4, "once", 300, ["special_e1"]),
  T("special_f1", "Special F1", "special", 3, 5, "once", 400, ["special_a"]),
  T("special_f2", "Special F2", "special", 3, 5, "once", 400, ["special_f1"]),
  T("special_g1", "Special G1", "special", 3, 5, "once", 400, ["special_a"]),
  T("special_g2", "Special G2", "special", 3, 5, "once", 400, ["special_g1"]),
  T("special_g3", "Special G3", "special", 3, 5, "once", 400, ["special_g2"]),
  T("special_h1", "Special H1", "special", 3, 5, "once", 400, ["special_a"]),
  T("special_i", "Special I", "special", 3, 5, "once", 400, ["special_a"]),
  // FINISHERS (зарезервировано: в бою пока рисуется стандартное фаталіті движка)
  ...["a1", "a2", "a3", "b1", "b2", "b3", "b4", "b5", "c"].map(k => T("fatality_" + k, "Fatality " + k.toUpperCase(), "finishers", 3, 6, "once", 900)),
  ...["a1", "a2", "b1", "c1"].map(k => T("friendship_" + k, "Friendship " + k.toUpperCase(), "finishers", 3, 6, "once", 900)),
  ...["a1", "b1", "c1", "c2"].map(k => T("animality_" + k, "Animality " + k.toUpperCase(), "finishers", 3, 6, "once", 900)),
  T("babality", "Babality", "finishers", 3, 6, "once", 900)
];
export const STATE_BY_ID = Object.fromEntries(STATES.map(s => [s.id, s]));
export const TIER1 = STATES.filter(s => s.tier === 1).map(s => s.id);

// какой слот «Special» играет спецудар бойца: roster special.sprite (необязательно) или по виду удара
export const DEFAULT_SPECIAL = { projectile: "special_a", shockwave: "special_b", dash: "special_c1", teleport: "special_d1", smash: "special_e1" };
export const specialSlot = ch => { const sp = (ch && ch.special) || {}; return STATE_BY_ID[sp.sprite] ? sp.sprite : (DEFAULT_SPECIAL[sp.kind] || "special_a"); };

// ---------- манифест fighter.json ----------
// { "format":1, "cell":[256,224], "anchor":[96,212], "stand":160, "scale":1, "pixel":false, "chroma":false, "ext":"png",
//   "states": { "stance_1": {"frames":6,"fps":8}, "lp": {"frames":3} } }   // frames обязателен, fps необязателен (иначе темп из каталога)
export function validateManifest(m) {
  const errors = [], warnings = [];
  if (!m || typeof m !== "object" || Array.isArray(m)) return { ok: false, errors: ["fighter.json: ожидается объект"], warnings, manifest: null };
  const cell = m.cell === undefined ? [CELL_W, CELL_H] : Number.isInteger(m.cell) ? [m.cell, m.cell] : m.cell;
  if (!Array.isArray(cell) || cell.length !== 2 || !cell.every(v => Number.isInteger(v) && v >= 32 && v <= 1024)) errors.push("cell: [ширина, высота] в px, 32..1024 (стандарт [" + CELL_W + "," + CELL_H + "])");
  const okc = !errors.length;
  const anchor = m.anchor === undefined ? (okc ? [Math.round(cell[0] * ANCHOR[0] / CELL_W), Math.round(cell[1] * ANCHOR[1] / CELL_H)] : ANCHOR) : m.anchor;
  if (!Array.isArray(anchor) || anchor.length !== 2 || !anchor.every(Number.isFinite)) errors.push("anchor: [x, y] в px клетки");
  const stand = m.stand === undefined ? STAND_H * (okc ? cell[1] / CELL_H : 1) : m.stand;
  if (!(stand > 0)) errors.push("stand: высота бойца в стойке, px (>0)");
  const scale = m.scale === undefined ? 1 : m.scale; if (!(scale > 0.2 && scale < 5)) errors.push("scale: 0.2..5");
  const ext = m.ext === undefined ? "png" : m.ext; if (ext !== "png" && ext !== "webp") errors.push("ext: png или webp");
  const states = {};
  if (!m.states || typeof m.states !== "object") errors.push("states: ожидается объект {состояние: {frames}}");
  else for (const [id, d] of Object.entries(m.states)) {
    if (!STATE_BY_ID[id]) { warnings.push("неизвестное состояние «" + id + "» (игнорируется)"); continue; }
    if (!d || !Number.isInteger(d.frames) || d.frames < 1 || d.frames > 64) { errors.push(id + ": frames — целое 1..64"); continue; }
    if (d.fps !== undefined && !(d.fps > 0 && d.fps <= 60)) { errors.push(id + ": fps 0..60"); continue; }
    states[id] = { frames: d.frames, fps: d.fps };
  }
  if (!errors.length) {
    if (!states.stance_1) errors.push("нет состояния stance_1: без стойки боец рисуется заглушкой");
    for (const id of TIER1) if (!states[id] && states.stance_1) warnings.push("нет " + id + " (будет запасное: " + (STATE_BY_ID[id].fb.join(" → ") || "заглушка") + ")");
  }
  return { ok: !errors.length, errors, warnings, manifest: errors.length ? null : { format: FORMAT, cell, anchor, stand, scale, pixel: !!m.pixel, chroma: !!m.chroma, ext, name: m.name || "", states } };
}

// ---------- выбор состояния по снимку боя ----------
export const frameIndex = (def, n, ms, fps) => { const k = Math.floor(Math.max(0, ms) * fps / 1000); return def.loop ? k % n : Math.min(n - 1, k); };
export const effFps = (def, n, override) => override || (def.loop ? def.rate : n * 1000 / def.rate);
export const stateMs = (id, n, override) => { const d = STATE_BY_ID[id]; return n * 1000 / effFps(d, n, override); };

// Animator — по одному на слот бойца. update() сообщает, какое состояние запрошено и сколько мс оно играет.
// s — вид бойца {x,y,fc,cr,bl,at,fr,st,kd,bu,dd,hp}, ctx — {ch, ph, rd, opp, has(id), len(id)}; now — мс.
export class Animator {
  constructor() { this.reset(); }
  reset() { this.id = null; this.t0 = 0; this.px = null; this.pfc = 0; this.mv = 0; this.down = false; this.tr = null; this.mdir = 1; }
  update(s, ctx, now) {
    const air = s.y + FH < FLOOR - 2, dx = this.px === null ? 0 : s.x - this.px; this.px = s.x;
    if (Math.abs(dx) > 0.7) { this.mv = 6; this.mdir = dx * s.fc > 0 ? 1 : -1; } else if (this.mv > 0) this.mv--;            // гистерезис: не мигать между ходьбой и стойкой
    const fwd = dx * s.fc > 0, o = ctx.opp, near = o ? Math.abs(o.x - s.x) < FW + 34 : false;
    let id;
    if (s.dd) id = "faint";
    else if (s.kd) id = "falling";
    else if (s.fr) id = "hit_high";
    else if (s.st && ctx.ph !== "finish") id = s.cr ? "crouch_hit" : "hit_high";
    else if (s.at) id = s.at === "hpunch" ? "hp" : s.at === "hkick" ? "hk" : s.at === "punch" ? (near ? "close_p" : "lp") : s.at === "kick" ? (near ? "close_k" : "lk") : s.at === "upper" ? "crouch_hp" : s.at === "sweep" ? "crouch_hk" : s.at === "air" ? "jump_k_1" : specialSlot(ctx.ch);
    else if (air) id = this.mv ? "jump_2" : "jump_1";
    else if (s.cr) id = s.bl ? "crouch_block" : "crouch";
    else if (s.bl) id = "block";
    else if (ctx.winner) id = ["win_a", "win_b", "win_c"][((ctx.rd || 1) - 1) % 3];
    else if (this.mv) id = fwd ? "walk" : "walk_back";
    else id = "stance_1";
    // переходные: подъём после падения, разворот
    if (this.down && !s.kd && !s.dd && !air && ctx.has("getting_up")) this.tr = { id: "getting_up", until: now + ctx.len("getting_up") };
    else if (this.pfc && this.pfc !== s.fc && !air && id === "stance_1" && ctx.has("turn")) this.tr = { id: "turn", until: now + ctx.len("turn") };
    this.down = !!s.kd; this.pfc = s.fc;
    if (this.tr && (now >= this.tr.until || s.dd || s.kd || s.at || s.st || air)) this.tr = null;
    if (this.tr && (id === "stance_1" || id === "walk" || id === "walk_back")) id = this.tr.id;
    if (id !== this.id) { this.id = id; this.t0 = now; this.sdir = this.mdir; }
    return { id, ms: now - this.t0, dir: this.sdir || 1 };
  }
}

// ---------- загрузка ----------
let makeCanvas = () => document.createElement("canvas");
export const setCanvasFactory = f => { makeCanvas = f; };
const tryImg = url => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
const getJson = async url => { const r = await fetch(url); if (!r.ok) throw new Error(String(r.status)); return r.json(); };

export class SpriteBank {
  constructor(id, base, ver) { this.id = id; this.url = base + id + "/"; this.ver = ver; this.man = null; this.imgs = {}; this.busy = {}; this.p = null; }
  start() { // загружает fighter.json и стойку; остальное первого уровня — в фоне. Не кидает ошибок: нет файлов = нет спрайтов.
    if (this.p) return this.p;
    return this.p = getJson(this.url + "fighter.json?v=" + this.ver).then(async j => {
      const v = validateManifest(j); this.man = v.ok ? v.manifest : false; this.issues = v;
      if (!this.man) return false;
      await this.load("stance_1"); TIER1.forEach(id => { if (id !== "stance_1") this.load(id); }); return !!this.imgs.stance_1;
    }).catch(() => { this.man = false; return false; });
  }
  ready() { return !!(this.man && this.imgs.stance_1); }
  has(id) { return !!(this.man && this.man.states[id]); }
  load(id) {
    if (!this.has(id) || this.imgs[id] || this.busy[id]) return this.busy[id] || Promise.resolve();
    return this.busy[id] = tryImg(this.url + id + "." + this.man.ext + "?v=" + this.ver).then(im => {
      if (im && this.man.chroma) { const cv = makeCanvas(); cv.width = im.width; cv.height = im.height; const g = cv.getContext("2d"); g.drawImage(im, 0, 0); try { const d = g.getImageData(0, 0, cv.width, cv.height); keyMagenta(d.data); g.putImageData(d, 0, 0); im = cv; } catch (e) {} }
      if (im) this.imgs[id] = im; return im;
    });
  }
  frames(id) { const d = this.man.states[id], im = this.imgs[id]; return im ? Math.max(1, Math.min(d.frames, Math.floor(im.width / this.man.cell[0]))) : d.frames; }
  resolve(id) { // запрошенное состояние → первое существующее и уже загруженное по цепочке запасных (вглубь); null = рисовать заглушкой
    if (!this.man) return null;
    const seen = new Set(), walk = c => {
      if (seen.has(c) || !STATE_BY_ID[c]) return null; seen.add(c);
      if (this.has(c)) { if (this.imgs[c]) return c; this.load(c); }
      for (const f of STATE_BY_ID[c].fb) { const r = walk(f); if (r) return r; } return null;
    };
    return walk(id);
  }
  len(id) { const r = this.resolve(id); return r ? stateMs(r, this.frames(r), this.man.states[r].fps) : 0; }
}

// ---------- рисование ----------
export function drawFrame(g, bank, id, frame, fc, x, y, alpha = 1) { // один кадр состояния: ноги на точке пола бойца, рисунок смотрит вправо
  const M = bank.man, im = bank.imgs[id]; if (!im) return false;
  const K = FH / M.stand * M.scale, cx = x + FW / 2, fy = y + FH;
  g.save(); g.translate(cx, fy); if (fc === -1) g.scale(-1, 1); g.globalAlpha = alpha; g.imageSmoothingEnabled = !M.pixel;
  g.drawImage(im, frame * M.cell[0], 0, M.cell[0], M.cell[1], -M.anchor[0] * K, -M.anchor[1] * K, M.cell[0] * K, M.cell[1] * K); g.restore(); return true;
}
// Рисует спрайтом по уже посчитанному состоянию want = {id, ms}. true — нарисован; false — вызывающий рисует ригом
export function drawSpriteWant(g, bank, want, ch, s, x, y, t) {
  if (!bank || !bank.ready()) return false;
  const id = bank.resolve(want.id); if (!id) return false;
  const n = bank.frames(id), d = STATE_BY_ID[id], fps = effFps(d, n, bank.man.states[id].fps), fi = frameIndex(d, n, want.ms, fps);
  g.fillStyle = "rgba(0,0,0,.5)"; g.beginPath(); g.ellipse(x + FW / 2, FLOOR, 35, 8, 0, 0, 6.283); g.fill();
  const tele = s.at === "special" && ch && ch.special && ch.special.kind === "teleport";
  if (!drawFrame(g, bank, id, fi, s.fc || 1, x, y, tele ? .55 : 1)) return false;
  drawStatus(g, s, x, y, t); return true;
}
// Совместимость: состояние + рисование спрайтом одним вызовом
export function drawFighterSprite(g, bank, anim, ch, s, x, y, t, ctx, now) {
  if (!bank || !bank.ready()) return false;
  ctx.has = id => bank.has(id) && !!bank.imgs[id]; ctx.len = id => bank.len(id);
  return drawSpriteWant(g, bank, anim.update(s, ctx, now), ch, s, x, y, t);
}
export function drawStance(g, bank, x, y, fc = 1) { return !!(bank && bank.ready() && drawFrame(g, bank, "stance_1", 0, fc, x, y)); }
