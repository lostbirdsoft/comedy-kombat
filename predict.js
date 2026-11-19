// Клиентское предсказание своего бойца + интерполяция чужого. Без привязки к браузеру (тестируется в Node).
// Идея: двигаем своего бойца сразу по тем же формулам, что на сервере, а при каждом снимке сервера
// сверяемся: позиция сервера + то, что мы успели пройти за последний RTT, — и мягко подтягиваемся к ней.
const FLOOR = 432, H = 142, W = 900, FW = 54, GRAV = 0.78;
export const MAX_SEP = 746; // как в sim.js: дальше экрана от соперника отойти нельзя
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Predictor {
  constructor() { this.reset(); }
  reset() { this.x = null; this.y = null; this.vx = 0; this.vy = 0; this.jumpState = "none"; this.jumpT = 0; this.waitT = 0; this.hist = []; this.srv = null; }

  // Один шаг физики = 1/60 с. c = { free, busy, speed }
  step(now, held, c) {
    if (this.x === null || !this.srv) return;
    if (!c.free) { // сервер управляет бойцом (удар по нам, заморозка, пауза раунда): просто следуем за ним
      this.vx = 0; this.vy = 0; this.jumpState = "none"; this.hist.length = 0;
      this.x += (this.srv.x - this.x) * 0.35; this.y += (this.srv.y - this.y) * 0.35;
      return;
    }
    const x0 = this.x;
    if (!c.busy && !held.b && !held.d) { if (held.r) this.vx = c.speed; else if (held.l) this.vx = -c.speed; }
    this.x += this.vx; this.vx *= 0.8;
    this.x = clamp(this.x, 24, (c.worldW || W) - 24 - FW);
    if (c.oppX !== undefined) this.x = clamp(this.x, c.oppX - MAX_SEP, c.oppX + MAX_SEP);
    if (this.jumpState === "air") {
      this.y += this.vy;
      if (this.y + H < FLOOR) this.vy += GRAV; else { this.y = FLOOR - H; this.vy = 0; this.jumpState = "wait"; this.waitT = now; }
    } else if (this.jumpState === "wait") this.y = FLOOR - H;
    else this.y += (this.srv.y - this.y) * 0.5;
    this.hist.push({ t: now, dx: this.x - x0 });
    while (this.hist.length && this.hist[0].t < now - 1500) this.hist.shift();
  }

  jump(now, held, c) {
    if (this.x === null || this.jumpState !== "none" || !c.free || held.b || this.y < FLOOR - H - 1) return;
    this.vy = -c.jumpV; this.jumpState = "air"; this.jumpT = now;
  }

  // Пришёл снимок сервера про нашего бойца.
  onSnap(now, f, c, rtt) {
    this.srv = { x: f.x, y: f.y };
    if (this.x === null) { this.x = f.x; this.y = f.y; return; }
    if (!c.free) return; // следование делает step()
    let pending = 0;
    for (const h of this.hist) if (h.t > now - rtt) pending += h.dx;
    const err = f.x + pending - this.x;
    if (Math.abs(err) > 70) this.x = f.x + pending; else this.x += err * 0.25;
    const grounded = f.y >= FLOOR - H - 1;
    if (this.jumpState === "air") {
      const age = now - this.jumpT;
      if (age > rtt + 90 && age < 500 && grounded) { this.jumpState = "none"; } // сервер прыжок не принял
    } else if (this.jumpState === "wait") {
      if (grounded || now - this.waitT > 600) this.jumpState = "none";
    }
  }
}

// Буфер снимков: чужого бойца показываем с небольшой задержкой, плавно между двумя снимками.
export class SnapBuffer {
  constructor() { this.b = []; }
  push(t, s) { this.b.push({ t, s }); if (this.b.length > 16) this.b.shift(); }
  latest() { const l = this.b[this.b.length - 1]; return l ? l.s : null; }
  at(tr) {
    const b = this.b; if (!b.length) return null;
    if (tr <= b[0].t) return b[0].s.f;
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].t <= tr && tr <= b[i].t) {
        const A = b[i - 1], B = b[i], k = (tr - A.t) / Math.max(1, B.t - A.t);
        return B.s.f.map((fb, j) => { const fa = A.s.f[j]; const o = Object.assign({}, k < 0.5 ? fa : fb);
          if (Math.abs(fb.x - fa.x) < 200) o.x = fa.x + (fb.x - fa.x) * k; else o.x = fb.x; // телепорт/притяжка — без плавности
          o.y = fa.y + (fb.y - fa.y) * k; return o; });
      }
    }
    return b[b.length - 1].s.f;
  }
}
