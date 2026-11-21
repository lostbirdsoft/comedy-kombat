// rig.js — процедурный боец со скелетом (v0.8.0): суставы, плавные удары, перенос веса, кувырок, победные позы.
// Рисует без картинок. Это «заглушка» стандарта спрайтов: каждое состояние из sprites.js (stance_1, walk, lp, jump_2…) имеет свою анимацию,
// поэтому и игра без спрайтов, и заглушки tools/sprites.mjs выглядят как живые бойцы, а не как набор прямоугольников.
// Система координат рига: начало — ПОЛ между стопами бойца, x вперёд (в сторону лица), y вниз (канвас). Отражение влево делает вызывающий.
// Ноги и руки — двухзвенный IK: поза задаётся положением стоп и кулаков, колени и локти считаются сами.
const PI = Math.PI, TAU = PI * 2;
const LEG1 = 36, LEG2 = 36, ARM1 = 27, ARM2 = 25, TORSO = 42, HEADR = 13;
const lerp = (a, b, t) => a + (b - a) * t, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), sstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// ---------- позы ----------
// px,py — таз; lean — наклон корпуса вперёд (рад); hd — наклон головы; hf/hr — кулаки (передний/задний); ff/fr — стопы (передняя/задняя);
// rot — поворот всего тела вокруг центра масс (кувырок); rx,ry — сдвиг; mouth — рот открыт; ef/er — в какую сторону сгибается локоть (+1 вниз, -1 вверх/наружу); dead — глаза-крестики
const DEF = { px: 0, py: -66, lean: .1, hd: 0, hf: [30, -98], hr: [20, -110], ff: [16, 0], fr: [-18, 0], rot: 0, rx: 0, ry: 0, mouth: 0, ef: 1, er: 1, dead: 0 };
const P = o => Object.assign({}, DEF, o);
// Кулаки интерполируются по дуге вокруг плеча (угол и длина), а не по прямой: рука не проходит сквозь плечо, локоть не перепрыгивает на другую сторону
const shoulder = (p, sg) => [p.px + Math.sin(p.lean) * (TORSO - 6) + sg * Math.cos(p.lean) * 3, p.py - Math.cos(p.lean) * (TORSO - 6) + sg * Math.sin(p.lean) * 3];
const polar = (p, k, sg) => { const s = shoulder(p, sg), h = p[k]; return [Math.atan2(h[1] - s[1], h[0] - s[0]), Math.hypot(h[0] - s[0], h[1] - s[1])]; };
function mix(a, b, t) {
  if (t <= 0) return a; if (t >= 1) return b; const r = {};
  for (const k in DEF) { if (k === "hf" || k === "hr") continue; const x = a[k], y = b[k]; r[k] = Array.isArray(x) ? [lerp(x[0], y[0], t), lerp(x[1], y[1], t)] : lerp(x, y, t); }
  for (const [k, sg] of [["hf", 1], ["hr", -1]]) { const [a1, r1] = polar(a, k, sg), [a2, r2] = polar(b, k, sg); let da = a2 - a1; da -= Math.round(da / TAU) * TAU; const ang = a1 + da * t, rr = lerp(r1, r2, t), sh = shoulder(r, sg); r[k] = [sh[0] + Math.cos(ang) * rr, sh[1] + Math.sin(ang) * rr]; }
  return r;
}
function track(frames, p) {
  if (p <= frames[0][0]) return frames[0][1];
  for (let i = 1; i < frames.length; i++) if (p <= frames[i][0]) { const [t0, a] = frames[i - 1], [t1, b] = frames[i]; return mix(a, b, sstep((p - t0) / (t1 - t0 || 1))); }
  return frames[frames.length - 1][1];
}

// стойка: дыхание, перенос веса с ноги на ногу (пятка отрывается), кулаки покачиваются
const stance = ms => {
  const w = ms * .0042, s = Math.sin(w), b = Math.sin(w * 2);
  return P({ px: 3 * s, py: -66 + 1.7 * b, lean: .1 + .025 * b, hd: -.05 + .03 * s, ff: [16 + 2 * s, -4 * Math.max(0, -s)], fr: [-18 - 2 * s, -4 * Math.max(0, s)], hf: [30 + 1.5 * s, -98 + 2 * b], hr: [20 - 1.5 * s, -110 - 2 * b] });
};
const B0 = stance(0);
const CROUCH = P({ px: -4, py: -38, lean: .3, hd: -.1, ff: [24, 0], fr: [-14, 0], hf: [30, -72], hr: [18, -82] });
const LYING = P({ px: -6, py: -8, lean: -1.5, hd: -.1, ff: [40, -8], fr: [26, -22], hf: [-10, -4], hr: [-66, -8], ef: -1, er: 1, mouth: 1 });
const FAINTED = P({ px: -8, py: -8, lean: -1.52, hd: .15, ff: [44, -4], fr: [40, -10], hf: [-6, -4], hr: [-62, -6], ef: -1, er: 1, mouth: 1, dead: 1 });
const walk = (ms, dir, run) => {
  const ph = ms * (run ? .013 : .0091), A = run ? 30 : 23, lift = run ? 20 : 14;
  const foot = o => [4 + dir * A * Math.sin(ph + o), -lift * Math.max(0, dir * Math.cos(ph + o))];
  return P({ py: -66 + (run ? 3 : 2.2) * Math.cos(2 * ph), lean: run ? .32 : dir > 0 ? .16 : .04, hd: run ? .1 : 0, ff: foot(0), fr: foot(PI), hf: [30 + 3 * Math.sin(ph), -98 - 2 * Math.cos(2 * ph)], hr: [20 - 3 * Math.sin(ph), -110] });
};
const REACH = { lp: 74, close_p: 58, hp: 80 };
const STRIKE_F = lenh => P({ px: 12, py: -65, lean: .32, hd: .05, mouth: 1, ff: [30, 0], fr: [-14, 0], hf: [lenh, -104], hr: [16, -108] });
const DASH_POSE = P({ py: -46, lean: .9, hd: .3, ff: [10, -48], fr: [-2, -56], hf: [26, -52], hr: [18, -60] });
const TUCK = P({ py: -62, lean: .05, ff: [14, -30], fr: [-10, -38], hf: [28, -118], hr: [8, -124] });
const FLIP = P({ py: -48, lean: .55, ff: [14, -52], fr: [2, -58], hf: [22, -56], hr: [14, -62] });

// длительности (мс) как в sim.js; для циклов — период
export const DUR = { stance_1: 1500, walk: 690, walk_back: 690, run: 480, crouch: 120, crouch_block: 100, block: 100, jump_1: 750, jump_2: 750, hit_high: 250, hit_low: 250, crouch_hit: 250,
  falling: 450, swept: 500, getting_up: 420, faint: 600, win_a: 900, win_b: 900, win_c: 900, dizzy: 1100,
  lp: 233, close_p: 233, hp: 367, lk: 333, close_k: 333, hk: 500, crouch_hp: 370, crouch_hk: 430, jump_k_1: 333, special_a: 300, special_b: 300, special_c1: 220, special_d1: 400, special_e1: 530 };
export const LOOPS = new Set(["stance_1", "walk", "walk_back", "run", "special_c1", "dizzy"]);
const D = id => DUR[id];
const atk = (id, frames) => ms => track(frames, clamp(ms / D(id), 0, 1));

const POSES = {
  stance_1: ms => stance(ms),
  walk: ms => walk(ms, 1), walk_back: ms => walk(ms, -1), run: ms => walk(ms, 1, true),
  crouch: ms => mix(stance(ms), CROUCH, sstep(ms / D("crouch"))),
  block: ms => mix(stance(ms), P({ px: -2, py: -64, lean: .02, hd: -.06, ff: [20, 0], fr: [-22, 0], hf: [26, -122], hr: [20, -106] }), sstep(ms / D("block"))),
  crouch_block: ms => mix(stance(ms), P({ px: -4, py: -38, lean: .3, hd: -.1, ff: [24, 0], fr: [-14, 0], hf: [24, -94], hr: [20, -80] }), sstep(ms / D("crouch_block"))),
  jump_1: ms => { const p = clamp(ms / D("jump_1"), 0, 1); return mix(B0, TUCK, Math.pow(Math.sin(PI * p), .6)); },
  jump_2: (ms, o) => { const p = clamp(ms / D("jump_2"), 0, 1), d = o.dir || 1, q = mix(B0, FLIP, clamp(Math.sin(PI * p) * 1.9, 0, 1)); return Object.assign({}, q, { rot: d * TAU * sstep(p) }); },
  hit_high: ms => { const a = Math.sin(PI * clamp(ms / D("hit_high"), 0, 1)); return mix(stance(ms), P({ px: -9, py: -64, lean: -.42, hd: -.55, mouth: 1, ff: [20, 0], fr: [-22, 0], hf: [-4, -134], hr: [-20, -122], ef: -1, er: -1 }), a); },
  hit_low: ms => { const a = Math.sin(PI * clamp(ms / D("hit_low"), 0, 1)); return mix(stance(ms), P({ px: 6, py: -62, lean: .85, hd: .35, mouth: 1, ff: [20, 0], fr: [-18, 0], hf: [10, -58], hr: [0, -62] }), a); },
  crouch_hit: ms => { const a = Math.sin(PI * clamp(ms / D("crouch_hit"), 0, 1)); return mix(CROUCH, P({ px: -12, py: -36, lean: -.1, hd: -.5, mouth: 1, ff: [24, 0], fr: [-14, 0], hf: [4, -86], hr: [-8, -80] }), a); },
  falling: ms => { const p = clamp(ms / D("falling"), 0, 1), q = mix(stance(ms), LYING, sstep(p)); return Object.assign({}, q, { ry: -9 * Math.sin(PI * p) }); },
  swept: ms => POSES.falling(ms),
  faint: ms => { const p = clamp(ms / D("faint"), 0, 1), q = mix(stance(ms), FAINTED, sstep(p)); return Object.assign({}, q, { ry: -9 * Math.sin(PI * p), dead: p > .35 ? 1 : 0 }); },
  getting_up: ms => { const p = clamp(ms / D("getting_up"), 0, 1); return p < .5 ? mix(LYING, CROUCH, sstep(p * 2)) : mix(CROUCH, stance(ms), sstep((p - .5) * 2)); },
  win_a: ms => { const e = sstep(ms / 260), w = ms * .011; return mix(stance(ms), P({ py: -67 + 2.5 * Math.sin(w * 2), lean: -.06, hd: -.12, ff: [19, 0], fr: [-21, 0], hf: [18, -160 + 4 * Math.sin(w)], hr: [-6, -162 - 4 * Math.sin(w + 1)], mouth: 1 }), e); },
  win_b: ms => { const e = sstep(ms / 260), w = ms * .012; return mix(stance(ms), P({ px: 2, py: -64 + 2 * Math.sin(w * 2), lean: -.12, hd: -.15, ff: [26, 0], fr: [-26, 0], hf: [28, -152 + 9 * Math.sin(w * 2)], hr: [-12, -80], er: -1, mouth: 1 }), e); },
  win_c: ms => { const e = sstep(ms / 260), w = ms * .01; return mix(stance(ms), P({ py: -63 + 2 * Math.sin(w * 2), lean: -.04, hd: -.1, ff: [24, 0], fr: [-24, 0], hf: [40, -118 + 2 * Math.sin(w)], hr: [-26, -118 - 2 * Math.sin(w)], ef: -1, er: -1, mouth: 1 }), e); },
  dizzy: ms => { const w = ms * .006; return P({ px: 6 * Math.sin(w), py: -64, lean: .12 + .26 * Math.sin(w), hd: .4 * Math.sin(w + 1), ff: [18, 0], fr: [-20, 0], hf: [12 + 8 * Math.sin(w), -54], hr: [-6 - 6 * Math.sin(w), -52], mouth: 1 }); },
  lp: atk("lp", [[0, B0], [.2, P({ px: -4, py: -66, lean: 0, hf: [6, -98], hr: [14, -108] })], [.42, STRIKE_F(REACH.lp)], [.58, STRIKE_F(REACH.lp)], [1, B0]]),
  close_p: atk("close_p", [[0, B0], [.2, P({ px: -2, py: -66, lean: .05, hf: [8, -96], hr: [14, -108] })], [.42, STRIKE_F(REACH.close_p)], [.58, STRIKE_F(REACH.close_p)], [1, B0]]),
  hp: atk("hp", [[0, B0], [.35, P({ px: -10, py: -64, lean: -.15, hd: -.1, ff: [20, 0], fr: [-22, 0], hf: [22, -110], hr: [-18, -96] })],
    [.58, P({ px: 22, py: -62, lean: .5, hd: .1, mouth: 1, ff: [36, 0], fr: [-10, 0], hf: [18, -104], hr: [REACH.hp, -106] })], [.7, P({ px: 22, py: -62, lean: .5, hd: .1, mouth: 1, ff: [36, 0], fr: [-10, 0], hf: [18, -104], hr: [REACH.hp, -106] })], [1, B0]]),
  lk: atk("lk", [[0, B0], [.28, P({ px: 2, py: -66, lean: -.1, ff: [20, -56], fr: [-14, 0], hf: [30, -112], hr: [8, -98] })],
    [.5, P({ px: 12, py: -66, lean: -.3, hd: .1, mouth: 1, ff: [90, -66], fr: [-16, 0], hf: [-2, -112], hr: [2, -96] })], [.62, P({ px: 12, py: -66, lean: -.3, hd: .1, mouth: 1, ff: [90, -66], fr: [-16, 0], hf: [-2, -112], hr: [2, -96] })], [1, B0]]),
  hk: atk("hk", [[0, B0], [.4, P({ px: 0, py: -66, lean: -.2, ff: [24, -60], fr: [-14, 0], hf: [26, -116], hr: [6, -102] })],
    [.62, P({ px: 20, py: -64, lean: -.55, hd: .15, mouth: 1, ff: [94, -70], fr: [-14, 0], hf: [-10, -120], hr: [-20, -100], ef: -1 })], [.74, P({ px: 20, py: -64, lean: -.55, hd: .15, mouth: 1, ff: [94, -70], fr: [-14, 0], hf: [-10, -120], hr: [-20, -100], ef: -1 })], [1, B0]]),
  crouch_hp: atk("crouch_hp", [[0, CROUCH], [.25, P({ px: -6, py: -34, lean: .35, ff: [24, 0], fr: [-14, 0], hf: [8, -36], hr: [16, -70] })],
    [.5, P({ px: 8, py: -62, lean: .15, hd: -.1, mouth: 1, ff: [22, 0], fr: [-10, 0], hf: [52, -130], hr: [14, -104] })], [.65, P({ px: 8, py: -62, lean: .15, hd: -.1, mouth: 1, ff: [22, 0], fr: [-10, 0], hf: [52, -130], hr: [14, -104] })], [1, CROUCH]]),
  crouch_hk: atk("crouch_hk", [[0, CROUCH], [.25, P({ px: -16, py: -30, lean: .5, ff: [-36, -8], fr: [-10, 0], hf: [8, -30], hr: [0, -20] })],
    [.5, P({ px: 30, py: -27, lean: .62, hd: .1, mouth: 1, ff: [112, -10], fr: [-34, -8], hf: [40, -14], hr: [12, -10] })], [.7, P({ px: 30, py: -27, lean: .62, hd: .1, mouth: 1, ff: [112, -10], fr: [-34, -8], hf: [40, -14], hr: [12, -10] })], [1, CROUCH]]),
  jump_k_1: atk("jump_k_1", [[0, TUCK], [.3, P({ py: -62, lean: -.1, ff: [16, -34], fr: [-8, -40], hf: [28, -118], hr: [8, -124] })],
    [.5, P({ px: 16, py: -64, lean: -.35, rot: -.3, mouth: 1, ff: [88, -34], fr: [-16, -46], hf: [-20, -110], hr: [-30, -96] })], [.8, P({ px: 16, py: -64, lean: -.35, rot: -.3, mouth: 1, ff: [88, -34], fr: [-16, -46], hf: [-20, -110], hr: [-30, -96] })], [1, TUCK]]),
  special_a: atk("special_a", [[0, B0], [.3, P({ px: -8, py: -64, lean: -.1, ff: [22, 0], fr: [-22, 0], hf: [-4, -92], hr: [-12, -96] })],
    [.5, P({ px: 8, py: -64, lean: .2, hd: .05, mouth: 1, ff: [28, 0], fr: [-16, 0], hf: [60, -98], hr: [56, -102] })], [.75, P({ px: 8, py: -64, lean: .2, hd: .05, mouth: 1, ff: [28, 0], fr: [-16, 0], hf: [60, -98], hr: [56, -102] })], [1, B0]]),
  special_b: atk("special_b", [[0, B0], [.3, P({ py: -62, lean: -.15, ff: [16, -54], fr: [-14, 0], hf: [10, -130], hr: [-8, -128] })],
    [.5, P({ py: -56, lean: .25, mouth: 1, ff: [26, 0], fr: [-10, 0], hf: [40, -54], hr: [30, -60] })], [.8, P({ py: -56, lean: .25, mouth: 1, ff: [26, 0], fr: [-10, 0], hf: [40, -54], hr: [30, -60] })], [1, B0]]),
  special_c1: (ms, o) => Object.assign({}, DASH_POSE, { rot: ms * .0285 }),
  special_d1: ms => { const p = clamp(ms / D("special_d1"), 0, 1); const q = mix(B0, P({ px: -2, py: -52, lean: .3, hd: .1, ff: [22, 0], fr: [-14, 0], hf: [34, -84], hr: [24, -90], er: -1 }), sstep(p * 3)); return Object.assign({}, q, { px: q.px + 1.5 * Math.sin(ms * .08) }); },
  special_e1: atk("special_e1", [[0, B0], [.4, P({ px: -6, py: -64, lean: -.25, hd: -.1, ff: [24, 0], fr: [-20, 0], hf: [10, -126], hr: [0, -124] })],
    [.55, P({ px: 20, py: -58, lean: .65, hd: .15, mouth: 1, ff: [40, 0], fr: [-12, 0], hf: [84, -64], hr: [76, -70] })], [.75, P({ px: 20, py: -58, lean: .65, hd: .15, mouth: 1, ff: [40, 0], fr: [-12, 0], hf: [84, -64], hr: [76, -70] })], [1, B0]])
};
export const rigHas = id => !!POSES[id];
export const rigLen = id => DUR[id] || 0;
export const rigFrameMs = (id, i, n) => { const d = DUR[id] || 600; return LOOPS.has(id) ? i / n * d : n > 1 ? i / (n - 1) * d : 0; };
const CHAIN = ["stance_1"]; // запасное состояние для всего, чего в риге нет
export function poseFor(id, ms, o = {}) { const f = POSES[id] || POSES[CHAIN[0]]; return f(Math.max(0, ms), o); }

// ---------- геометрия ----------
function ik(a, t, l1, l2, side) {
  const dx = t[0] - a[0], dy = t[1] - a[1], d = Math.hypot(dx, dy);
  let ux = dx / (d || 1), uy = dy / (d || 1);
  if (d < 18) { const w = d / 18; ux = ux * w + .8 * (1 - w); uy = uy * w + .6 * (1 - w); const n = Math.hypot(ux, uy) || 1; ux /= n; uy /= n; } // цель у самого плеча/бедра: направление плавно «вниз», без переворота локтя
  const dm = clamp(d, 18, l1 + l2 - .01), aa = (l1 * l1 - l2 * l2 + dm * dm) / (2 * dm), h = Math.sqrt(Math.max(0, l1 * l1 - aa * aa));
  return { j: [a[0] + ux * aa - uy * h * side, a[1] + uy * aa + ux * h * side], e: [a[0] + ux * dm, a[1] + uy * dm] };
}
export function solve(p) {
  const L = p.lean, up = [Math.sin(L), -Math.cos(L)], fp = [Math.cos(L), Math.sin(L)];
  const pel = [p.px, p.py], neck = [pel[0] + up[0] * TORSO, pel[1] + up[1] * TORSO], shb = [pel[0] + up[0] * (TORSO - 6), pel[1] + up[1] * (TORSO - 6)];
  const shF = [shb[0] + fp[0] * 3, shb[1] + fp[1] * 3], shR = [shb[0] - fp[0] * 3, shb[1] - fp[1] * 3];
  const hipF = [pel[0] + 3, pel[1]], hipR = [pel[0] - 3, pel[1]];
  const T = L + p.hd, hup = [Math.sin(T), -Math.cos(T)];
  return { pel, neck, shb, shF, shR, hipF, hipR, up, fp, T, hc: [neck[0] + hup[0] * (HEADR + 1), neck[1] + hup[1] * (HEADR + 1)],
    legF: ik(hipF, p.ff, LEG1, LEG2, -1), legR: ik(hipR, p.fr, LEG1, LEG2, -1), armF: ik(shF, p.hf, ARM1, ARM2, clamp(p.ef, -1, 1)), armR: ik(shR, p.hr, ARM1, ARM2, clamp(p.er, -1, 1)) };
}

// ---------- рисование ----------
const INK = "#0b0b10";
const hex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ""); const n = m ? parseInt(m[1], 16) : 0x888888; return [n >> 16, n >> 8 & 255, n & 255]; };
const shade = (c, k) => { const [r, g, b] = hex(c); const f = v => Math.round(clamp(k < 1 ? v * k : v + (255 - v) * (k - 1), 0, 255)).toString(16).padStart(2, "0"); return "#" + f(r) + f(g) + f(b); };
const poly = (g, pts) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); };
function stroked(g, fill, w = 2.6) { g.fillStyle = fill; g.fill(); g.lineWidth = w; g.strokeStyle = INK; g.lineJoin = "round"; g.stroke(); }
function chain(g, pts, w, col) { // двухзвенная конечность: контур, затем заливка
  g.lineCap = "round"; g.lineJoin = "round"; const path = () => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); };
  path(); g.strokeStyle = INK; g.lineWidth = w + 3.4; g.stroke(); path(); g.strokeStyle = col; g.lineWidth = w; g.stroke();
}
function seg(g, a, b, w, col) { g.lineCap = "round"; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.strokeStyle = col; g.lineWidth = w; g.stroke(); }
const buildOf = ch => { const hp = ch && ch.stats && ch.stats.hp; return hp >= 120 ? 1.22 : hp && hp <= 92 ? .95 : 1; };

function drawHead(g, ch, J, p, id, bf) {
  const skin = ch.skin || "#e0ac69", col = ch.color || "#888", trim = ch.trim || "#ddd", look = ch.look || "bald";
  g.save(); g.translate(J.hc[0], J.hc[1]); g.rotate(J.T);
  if (look === "hair") { const hl = Math.abs(J.T) > .9 ? .35 : 1; g.beginPath(); g.moveTo(-6, -8); g.quadraticCurveTo(-30 * hl, 2, -24 * hl, 30 * hl); g.lineTo(-10, 20 * hl); g.lineTo(-4, 4); g.closePath(); stroked(g, "#1b1424"); } // лёжа волосы короче: не уходят под пол
  g.beginPath(); g.arc(0, 0, HEADR, 0, TAU); stroked(g, skin, 2.8);
  g.beginPath(); g.ellipse(-3, 2, 3, 4, 0, 0, TAU); g.fillStyle = shade(skin, .82); g.fill();            // ухо
  if (look === "hair") { g.beginPath(); g.arc(0, -1, HEADR + 1, PI * 1.05, PI * 2.05); g.lineTo(6, -2); g.quadraticCurveTo(2, -8, -6, -3); g.closePath(); stroked(g, "#1b1424", 2.2); }
  else if (look === "cap") { g.beginPath(); g.arc(0, -2, HEADR + .5, PI, TAU); g.closePath(); stroked(g, col, 2.4); g.beginPath(); g.ellipse(13, -2, 9, 3, 0, 0, TAU); stroked(g, trim, 2); }
  else if (look === "hat") { const hs = Math.abs(J.T) > .9 ? .5 : 1; g.beginPath(); g.ellipse(0, -7, 19 * hs, 4.5, 0, 0, TAU); stroked(g, shade(col, .55), 2.4); g.beginPath(); g.rect(-9, -7 - 15 * hs, 18, 15 * hs); stroked(g, shade(col, .75), 2.4); g.fillStyle = trim; g.fillRect(-9, -11 + (hs < 1 ? 5 : 0), 18, 4); }
  else if (look === "crown") { const cs = Math.abs(J.T) > .9 ? .45 : 1; poly(g, [[-11, -9], [-12, -9 - 13 * cs], [-5, -9 - 6 * cs], [0, -9 - 16 * cs], [5, -9 - 6 * cs], [12, -9 - 13 * cs], [11, -9]]); stroked(g, "#fbbf24", 2.2); g.fillStyle = "#ef4444"; g.fillRect(-2, -9 - 8 * cs, 4, 4); }
  else if (look === "mask") { g.beginPath(); g.rect(-HEADR, 1, HEADR * 2, 12); g.fillStyle = col; g.fill(); g.beginPath(); g.rect(-HEADR, -5, HEADR * 2, 6); g.fillStyle = trim; g.fill(); g.beginPath(); g.arc(0, 0, HEADR, 0, TAU); g.lineWidth = 2.8; g.strokeStyle = INK; g.stroke(); }
  else if (look === "suit") { g.beginPath(); g.arc(0, -1, HEADR + .5, PI * 1.08, PI * 1.95); g.lineTo(2, -9); g.closePath(); stroked(g, "#9ca3af", 2); }
  else { g.beginPath(); g.ellipse(-3, -8, 5, 2.4, -.5, 0, TAU); g.fillStyle = "rgba(255,255,255,.35)"; g.fill(); }
  // лицо: глаз, бровь, рот
  if (p.dead) { g.strokeStyle = INK; g.lineWidth = 1.8; g.beginPath(); g.moveTo(4, -5); g.lineTo(10, 1); g.moveTo(10, -5); g.lineTo(4, 1); g.stroke(); }
  else { g.beginPath(); g.ellipse(7, -2, 3.2, 3.8, 0, 0, TAU); g.fillStyle = "#fff"; g.fill(); g.lineWidth = 1.2; g.strokeStyle = INK; g.stroke(); g.beginPath(); g.arc(8, -2, 1.7, 0, TAU); g.fillStyle = INK; g.fill();
    g.beginPath(); g.moveTo(3, -7 - (p.mouth ? 1 : 0)); g.lineTo(11, -4.5 + (p.mouth ? 1.5 : 0)); g.lineWidth = 2; g.strokeStyle = INK; g.stroke(); }
  if (p.mouth) { g.beginPath(); g.ellipse(8, 7, 3.4, 3, 0, 0, TAU); g.fillStyle = "#3b0d12"; g.fill(); g.lineWidth = 1.2; g.strokeStyle = INK; g.stroke(); }
  else { g.beginPath(); g.moveTo(5, 7); g.lineTo(11, 6); g.lineWidth = 1.6; g.strokeStyle = INK; g.stroke(); }
  g.restore();
}

function drawShoe(g, ch, ank, leg, fly) { // ступня: на полу горизонтально, в воздухе вдоль голени
  const d = [leg.e[0] - leg.j[0], leg.e[1] - leg.j[1]], n = Math.hypot(d[0], d[1]) || 1, perp = [d[1] / n, -d[0] / n], t = clamp(-ank[1] / 12, 0, 1), dir = [lerp(1, perp[0], t), lerp(0, perp[1], t)], m = Math.hypot(dir[0], dir[1]) || 1;
  const toe = [ank[0] + dir[0] / m * 14, ank[1] + dir[1] / m * 14 + (1 - t) * 0];
  g.lineCap = "round"; g.beginPath(); g.moveTo(ank[0] - 3, ank[1] + 1); g.lineTo(toe[0], toe[1] + 1); g.strokeStyle = INK; g.lineWidth = 12.5; g.stroke();
  g.beginPath(); g.moveTo(ank[0] - 3, ank[1] + 1); g.lineTo(toe[0], toe[1] + 1); g.strokeStyle = "#16161d"; g.lineWidth = 9; g.stroke();
  g.beginPath(); g.moveTo(ank[0] - 2, ank[1] + 4.2); g.lineTo(toe[0] - 1, toe[1] + 4.2); g.strokeStyle = ch.trim || "#ddd"; g.lineWidth = 1.6; g.stroke();
}
const maxHand = (A, B) => Math.hypot(A[0] - B[0], A[1] - B[1]);

// Рисует бойца в начале координат (ноги на (0,0), лицом вправо). id — состояние (stance_1, lp, …), ms — сколько оно уже играет.
export function drawRig(g, ch, id, ms, o = {}) {
  const bf = buildOf(ch), pose = poseFor(id, ms, o), J = solve(pose), skin = ch.skin || "#e0ac69", shirt = ch.color || "#888", trim = ch.trim || "#ddd", suit = ch.look === "suit", pants = suit ? "#334155" : shade(shirt, .32);
  g.save(); g.translate(pose.rx, pose.ry - 6); // −6: подошвы (а не щиколотки) стоят на линии пола
  if (pose.rot) { g.translate(0, -70); g.rotate(pose.rot); g.translate(0, 70); }
  // следы замаха: где кулак/стопа были 45 мс назад
  if (!pose.rot && D(id) && ms > 20 && !LOOPS.has(id) && /^(lp|hp|lk|hk|close_|crouch_h|jump_k|special_[ae])/.test(id)) {
    const old = solve(poseFor(id, ms - 45, o)), pairs = [[old.armF.e, J.armF.e], [old.armR.e, J.armR.e], [old.legF.e, J.legF.e]];
    for (const [a, b] of pairs) if (maxHand(a, b) > 16) { g.lineCap = "round"; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.strokeStyle = "rgba(255,255,255,.38)"; g.lineWidth = 9; g.stroke(); g.lineWidth = 4; g.strokeStyle = "rgba(255,255,255,.6)"; g.stroke(); }
  }
  const arm = (A, sh, back) => { const sleeve = back ? shade(shirt, .78) : shirt, fore = back ? shade(skin, .86) : skin, w = 9.5 * bf;
    chain(g, [sh, A.j, A.e], w, fore); seg(g, sh, A.j, w, sleeve);
    g.beginPath(); g.arc(A.e[0], A.e[1], 6.6 * bf, 0, TAU); stroked(g, fore, 2.4);
    const d = [A.e[0] - A.j[0], A.e[1] - A.j[1]], n = Math.hypot(d[0], d[1]) || 1; seg(g, [A.e[0] - d[0] / n * 8, A.e[1] - d[1] / n * 8], [A.e[0] - d[0] / n * 5, A.e[1] - d[1] / n * 5], w + 1, back ? shade(trim, .8) : trim); };
  const leg = (Lg, hip, back, foot) => { const col = back ? shade(pants, .8) : pants; chain(g, [hip, Lg.j, Lg.e], 12.5 * bf, col); drawShoe(g, ch, Lg.e, Lg, foot); };
  const rearFront = pose.hr[0] > pose.hf[0] + 25; // удар задней рукой (сильная рука): она рисуется спереди корпуса
  arm(rearFront ? J.armF : J.armR, rearFront ? J.shF : J.shR, true);
  leg(J.legR, J.hipR, true, pose.fr); leg(J.legF, J.hipF, false, pose.ff);
  // корпус
  const wh = 10 * bf, wc = 13.5 * bf, torso = [[J.pel[0] - J.fp[0] * wh, J.pel[1] - J.fp[1] * wh], [J.pel[0] + J.fp[0] * wh, J.pel[1] + J.fp[1] * wh], [J.shb[0] + J.fp[0] * wc, J.shb[1] + J.fp[1] * wc], [J.neck[0] + J.fp[0] * 6, J.neck[1] + J.fp[1] * 6], [J.neck[0] - J.fp[0] * 6, J.neck[1] - J.fp[1] * 6], [J.shb[0] - J.fp[0] * wc, J.shb[1] - J.fp[1] * wc]];
  poly(g, torso); stroked(g, suit ? shade(shirt, .8) : shirt, 2.8);
  if (suit) { poly(g, [[J.neck[0] + J.fp[0] * 5, J.neck[1] + J.fp[1] * 5], [J.shb[0] + J.fp[0] * 9, J.shb[1] + J.fp[1] * 9], [J.pel[0] + J.fp[0] * 8 + J.up[0] * 10, J.pel[1] + J.fp[1] * 8 + J.up[1] * 10], [J.pel[0] + J.up[0] * 12, J.pel[1] + J.up[1] * 12]]); g.fillStyle = "#f8fafc"; g.fill(); seg(g, [J.neck[0] + J.fp[0] * 3, J.neck[1] + J.fp[1] * 3], [J.pel[0] + J.fp[0] * 3 + J.up[0] * 14, J.pel[1] + J.fp[1] * 3 + J.up[1] * 14], 4, trim); }
  else { poly(g, [[J.shb[0] - J.fp[0] * wc, J.shb[1] - J.fp[1] * wc], [J.shb[0] + J.fp[0] * wc, J.shb[1] + J.fp[1] * wc], [J.shb[0] + J.fp[0] * wc + J.up[0] * -9, J.shb[1] + J.fp[1] * wc - J.up[1] * 9], [J.shb[0] - J.fp[0] * wc - J.up[0] * 9, J.shb[1] - J.fp[1] * wc - J.up[1] * 9]]); g.fillStyle = trim; g.globalAlpha = .55; g.fill(); g.globalAlpha = 1; }
  seg(g, [J.pel[0] - J.fp[0] * wh, J.pel[1] - J.fp[1] * wh], [J.pel[0] + J.fp[0] * wh, J.pel[1] + J.fp[1] * wh], 5.2, trim);
  drawHead(g, ch, J, pose, id, bf);
  if (rearFront) arm(J.armR, J.shR, false); else arm(J.armF, J.shF, false);
  if (id === "special_e1") { // молот контракта в руках
    const e = J.armF.e, r = J.armR.e, mid = [(e[0] + r[0]) / 2, (e[1] + r[1]) / 2], p = clamp(ms / D("special_e1"), 0, 1), ang = lerp(-2.4, .3, sstep((p - .35) / .22)), len = 34, hx = mid[0] + Math.cos(ang) * len, hy = mid[1] + Math.sin(ang) * len;
    seg(g, [mid[0] - Math.cos(ang) * 14, mid[1] - Math.sin(ang) * 14], [hx, hy], 9, INK); seg(g, [mid[0] - Math.cos(ang) * 14, mid[1] - Math.sin(ang) * 14], [hx, hy], 5, "#92400e");
    g.save(); g.translate(hx, hy); g.rotate(ang); g.beginPath(); g.rect(-3, -15, 20, 30); stroked(g, trim, 3); g.fillStyle = shade(trim, .7); g.fillRect(11, -15, 6, 30); g.restore();
  }
  const sc = (ch.special && ch.special.color) || trim;
  if (id === "special_a") { const p = clamp(ms / D("special_a"), 0, 1), k = sstep((p - .35) / .2) * (1 - sstep((p - .8) / .2)); if (k > .02) { const a = J.armF.e, b = J.armR.e, c = [(a[0] + b[0]) / 2 + 6, (a[1] + b[1]) / 2]; const gr = g.createRadialGradient ? g.createRadialGradient(c[0], c[1], 1, c[0], c[1], 17 * k + 3) : null; g.beginPath(); g.arc(c[0], c[1], 17 * k + 3, 0, TAU); if (gr) { gr.addColorStop(0, "#fff"); gr.addColorStop(.45, sc); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; } else g.fillStyle = sc; g.fill(); } }
  if (id === "special_d1") { const p = clamp(ms / D("special_d1"), 0, 1); for (let k = 0; k < 3; k++) { const r = 14 + 34 * ((p * 1.6 + k / 3) % 1); g.beginPath(); g.ellipse(2, -62, r * .55, r, 0, 0, TAU); g.lineWidth = 2.4; g.strokeStyle = sc; g.globalAlpha = .7 * (1 - r / 50); g.stroke(); } g.globalAlpha = 1; }
  if (id === "special_b") { const p = clamp(ms / D("special_b"), 0, 1), k = sstep((p - .45) / .5); if (k > .02 && k < 1) { g.beginPath(); g.ellipse(J.legF.e[0] + 4, 0, 10 + 36 * k, 3 + 8 * k, 0, 0, TAU); g.lineWidth = 3; g.strokeStyle = sc; g.globalAlpha = 1 - k; g.stroke(); g.globalAlpha = 1; } }
  if (id === "dizzy") { g.fillStyle = "#fde047"; for (let i = 0; i < 3; i++) { const a = ms * .006 + i * 2.1; g.fillRect(J.hc[0] + Math.cos(a) * 16 - 2, J.hc[1] - 20 + Math.sin(a) * 4, 5, 5); } }
  g.restore();
}
