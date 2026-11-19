// fighter.js — рисование бойца на canvas (тело, голова, удары, заморозка, горение). Вынесено из app.js, чтобы можно было тестировать кадры.
const FLOOR = 432, FH = 142, FW = 54;

export function drawFighter(g, ch, s, x, y, t) {
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

