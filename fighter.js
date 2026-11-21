// fighter.js — рисование бойца на canvas: тень, скелетный риг (rig.js), горение/лёд/звёздочки. Вынесено из app.js, чтобы можно было тестировать кадры.
// Боец без спрайтов рисуется ригом: у каждого состояния из sprites.js своя анимация (стойка с переносом веса, ходьба, удары, кувырок, падение, победа).
import { drawRig, DUR } from "./rig.js?v=16";
export const FLOOR = 432, FH = 142, FW = 54;
const AT_STATE = { punch: "lp", kick: "lk", hpunch: "hp", hkick: "hk", upper: "crouch_hp", sweep: "crouch_hk", air: "jump_k_1" };
const SPECIAL_STATE = { projectile: "special_a", shockwave: "special_b", dash: "special_c1", teleport: "special_d1", smash: "special_e1" };
// Состояние по виду бойца (для карточек, превью и заглушек, где нет аниматора). Возвращает [id, ms]: удар показан в середине замаха, лежачие — лежат.
export function stateFromView(s, ch) {
  const air = s.y !== undefined && s.y + FH < FLOOR - 2;
  let id = "stance_1", ms = 0;
  if (s.dd) { id = "faint"; ms = 9999; } else if (s.kd) { id = "falling"; ms = 9999; }
  else if (s.fr || s.st) { id = s.cr ? "crouch_hit" : "hit_high"; ms = 100; }
  else if (s.at) { id = s.at === "special" ? (SPECIAL_STATE[ch && ch.special && ch.special.kind] || "special_a") : AT_STATE[s.at] || "lp"; ms = (DUR[id] || 300) * .55; }
  else if (air) { id = "jump_1"; ms = 375; }
  else if (s.cr) { id = s.bl ? "crouch_block" : "crouch"; ms = 999; }
  else if (s.bl) { id = "block"; ms = 999; }
  return [id, ms];
}
export function drawStatus(g, s, x, y, t) { // заморозка, горение, звёздочки оглушения: поверх бойца (и риг, и спрайт)
  const ly = y + FH - 28, lying = s.dd || s.kd;
  if (s.st && !s.fr && !lying) { g.fillStyle = "#fde047"; for (let i = 0; i < 3; i++) { const a = t * .15 + i * 2.1; g.fillRect(x + 27 + Math.cos(a) * 16 - 2, y - 6 + Math.sin(a) * 4, 5, 5); } }
  if (s.bu) lying ? flames(g, x - 10, ly - 10, 100, t, 3) : flames(g, x - 4, y, FW + 8, t, 6);
  if (s.fr) lying ? iceBlock(g, x - 26, ly - 6, 120, 38) : iceBlock(g, x - 6, y - 4, FW + 12, FH + 4);
}
// s — вид бойца {x,y,fc,cr,bl,at,fr,st,kd,bu,dd}; x,y — левый верх хитбокса. id/ms/dir (необязательно) — состояние и время от аниматора; без них состояние берётся по виду.
export function drawFighter(g, ch, s, x, y, t, id, ms, dir) {
  if (!id) [id, ms] = stateFromView(Object.assign({ y }, s), ch);
  if (s.fr) ms = Math.min(ms || 0, 100); // заморожен: застывает в позе удара
  const cx = x + FW / 2, fy = y + FH, air = Math.max(0, FLOOR - fy), k = 1 - Math.min(.45, air / 320);
  g.save(); g.fillStyle = "rgba(0,0,0,.5)"; g.beginPath(); g.ellipse(cx, FLOOR, 35 * k, 8 * k, 0, 0, 6.283); g.fill();
  g.translate(cx, fy); if (s.fc === -1) g.scale(-1, 1);
  if (s.at === "special" && ch.special && ch.special.kind === "teleport") g.globalAlpha = .55;
  drawRig(g, ch, id, ms || 0, { dir: dir || 1 }); g.restore();
  drawStatus(g, s, x, y, t);
}

export function flames(g, x, y, w, t, n) { // горение
  for (let k = 0; k < n; k++) {
    const fx = x + (w / n) * (k + .5), base = y + 130 - ((k * 37 + t * 2.2) % 100), hh = 16 + 8 * Math.sin(t * .3 + k * 1.7);
    g.fillStyle = k % 2 ? "rgba(249,115,22,.85)" : "rgba(253,224,71,.85)";
    g.beginPath(); g.moveTo(fx - 7, base); g.quadraticCurveTo(fx, base - hh, fx + 2 * Math.sin(t * .4 + k), base - hh - 8); g.quadraticCurveTo(fx + 2, base - hh, fx + 7, base); g.fill();
  }
}
export function iceBlock(g, x, y, w, h) { // заморозка: глыба, блик и сосульки
  g.fillStyle = "rgba(150,235,255,.55)"; g.strokeStyle = "#fff"; g.lineWidth = 2; g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h);
  g.fillStyle = "rgba(255,255,255,.55)"; g.beginPath(); g.moveTo(x + 6, y + h * .35); g.lineTo(x + 18, y + 6); g.lineTo(x + 26, y + 10); g.lineTo(x + 14, y + h * .45); g.fill();
  g.fillStyle = "rgba(200,245,255,.9)"; for (let k = 0; k < 4; k++) { const ix = x + 5 + k * (w - 10) / 4; g.beginPath(); g.moveTo(ix, y + h); g.lineTo(ix + 8, y + h); g.lineTo(ix + 4, y + h + 11); g.fill(); }
}

