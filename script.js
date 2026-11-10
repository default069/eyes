/* ==========================================================================
   Dilobar — cinematic eye intro
   Sequential timeline:
     1. lines draw in  →  2. eye draws, opens, looks around, blinks
     3. lines fade, camera zooms into the pupil
     4. hearts burst out of the pupil
     5. name + tagline appear  →  6. Replay
   Pure Vanilla JS / SVG / Canvas. No libraries.
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     CONFIG — edit freely
     ------------------------------------------------------------------------ */
  const CONFIG = {
    name: 'Dilobar',
    tagline: 'You are special. ♡',  // null = keep HTML text, '' = hide it
    zoomMs: 6400,                   // length of the zoom into the pupil
    cssZoomMax: 3                   // zoom handled by CSS transform; the rest by SVG viewBox
  };

  /* ------------------------------------------------------------------------
     DOM
     ------------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), linesSvg = $('lines'), camera = $('camera'), eyeSvg = $('eye');
  const glow = $('glow'), canvas = $('hearts'), finalEl = $('final'), finalInner = $('finalInner');
  const nameEl = $('name'), taglineEl = $('tagline'), replayBtn = $('replay'), ambient = $('ambient');

  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs, parent) => {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  };

  /* ------------------------------------------------------------------------
     Helpers: math, easing, cancellable timeline primitives
     ------------------------------------------------------------------------ */
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  const ease = {
    linear: (t) => t,
    inQuad: (t) => t * t,
    outQuad: (t) => 1 - (1 - t) * (1 - t),
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    // slow dolly at first, then accelerating "falling into the pupil"
    zoom: (t) => 0.55 * Math.pow(t, 2.1) + 0.45 * (t * t * (3 - 2 * t))
  };

  let runId = 0;              // incremented on every (re)play; stale timelines stop
  let reduced = false;        // prefers-reduced-motion
  class Cancel extends Error {}

  const T = (ms) => (reduced ? ms * 0.5 : ms);

  const sleep = (ms, id) => new Promise((res, rej) => {
    setTimeout(() => (id === runId ? res() : rej(new Cancel())), T(ms));
  });

  const tween = (ms, easing, fn, id) => new Promise((res, rej) => {
    const dur = T(ms);
    const t0 = performance.now();
    (function tick(now) {
      if (id !== runId) return rej(new Cancel());
      const t = clamp((now - t0) / dur, 0, 1);
      fn(easing(t), t);
      if (t < 1) requestAnimationFrame(tick); else res();
    })(t0);
  });

  /* ------------------------------------------------------------------------
     Layout: one place that maps "world" units onto the screen
     ------------------------------------------------------------------------ */
  const view = { w: 0, h: 0, eyeW: 0, zoom: 1 };

  function layout() {
    view.w = stage.clientWidth || window.innerWidth;
    view.h = stage.clientHeight || window.innerHeight;
    // eye width: responsive, always centred
    view.eyeW = Math.min(view.w * 0.84, 640, view.h * 1.1);
    applyViews();
    Hearts.resize();
    if (finalEl.classList.contains('show')) updateAvoidZone();
  }

  function applyViews() {
    // Lines: 1 unit = eyeW / 1000 px, origin at screen centre
    const k = view.eyeW / 1000;
    const lw = view.w / k, lh = view.h / k;
    linesSvg.setAttribute('viewBox', `${-lw / 2} ${-lh / 2} ${lw} ${lh}`);
    linesSvg.style.setProperty('--lw', (1.1 / k).toFixed(3));

    // Eye: 400 units = eyeW; centre (200,120) is always the screen centre.
    // Zoom is split: CSS transform up to cssZoomMax, remaining via viewBox.
    // This keeps raster layers small (important on mobile) and the lines crisp.
    const ke = view.eyeW / 400;
    const z = view.zoom;
    const cssZ = Math.min(z, CONFIG.cssZoomMax);
    const vbZ = z / cssZ;
    const ew = view.w / ke / vbZ, eh = view.h / ke / vbZ;
    eyeSvg.setAttribute('viewBox', `${(200 - ew / 2).toFixed(3)} ${(120 - eh / 2).toFixed(3)} ${ew.toFixed(3)} ${eh.toFixed(3)}`);
    camera.style.transform = cssZ > 1.001 ? `scale(${cssZ.toFixed(4)})` : '';
    eyeSvg.style.setProperty('--sw', (1 / Math.sqrt(z)).toFixed(3));   // strokes stay delicate
  }

  /* ------------------------------------------------------------------------
     Background lines (symmetrical composition, generated once)
     ------------------------------------------------------------------------ */
  function buildLines() {
    linesSvg.textContent = '';
    const add = (d, delay, dur, opacity) => {
      const p = svgEl('path', { d, pathLength: '1' }, linesSvg);
      p.style.setProperty('--d', delay + 's');
      p.style.setProperty('--dur', dur + 's');
      if (opacity != null) p.style.strokeOpacity = opacity;
    };
    const ellipse = (rx, ry) => `M${-rx} 0A${rx} ${ry} 0 1 1 ${rx} 0A${rx} ${ry} 0 1 1 ${-rx} 0Z`;
    const A = 560, B = 360;                       // "keep-out" ellipse around the eye
    const edge = (th) => (A * B) / Math.hypot(B * Math.cos(th), A * Math.sin(th));

    // 16 radial lines — alternate drawing inwards / outwards
    for (let i = 0; i < 16; i++) {
      const th = (i * Math.PI) / 8;
      const c = Math.cos(th), s = Math.sin(th);
      const r0 = edge(th) + 40;
      const len = i % 4 === 0 ? 1600 : i % 4 === 2 ? 900 : 260;
      const r1 = r0 + len;
      const inward = i % 2 === 1;
      const [ra, rb] = inward ? [r1, r0] : [r0, r1];
      const delay = (i % 4 === 0 ? 0 : i % 4 === 2 ? 0.25 : 0.5) + (inward ? 0.1 : 0);
      add(`M${(c * ra).toFixed(1)} ${(s * ra).toFixed(1)}L${(c * rb).toFixed(1)} ${(s * rb).toFixed(1)}`,
        delay, 1.8, i % 4 === 1 || i % 4 === 3 ? 0.55 : 0.9);
    }
    // concentric ellipses
    add(ellipse(640, 420), 0.3, 2.2, 0.55);
    add(ellipse(780, 540), 0.55, 2.4, 0.3);
    // diamond
    add('M-700 0L0 -480L700 0L0 480Z', 0.8, 2.2, 0.25);
    // tiny ticks around the inner ellipse
    for (let i = 0; i < 16; i++) {
      const th = (i * Math.PI) / 8 + Math.PI / 16;
      const c = Math.cos(th), s = Math.sin(th);
      const r0 = (640 * 420) / Math.hypot(420 * c, 640 * s);
      add(`M${(c * r0).toFixed(1)} ${(s * r0).toFixed(1)}L${(c * (r0 + 26)).toFixed(1)} ${(s * (r0 + 26)).toFixed(1)}`,
        1.0, 1.2, 0.5);
    }
  }

  /* ------------------------------------------------------------------------
     The eye
     ------------------------------------------------------------------------ */
  const clipShape = $('clipShape'), eyeFill = $('eyeFill');
  const lidUpper = $('lidUpper'), lidLower = $('lidLower'), crease = $('crease');
  const lashesG = $('lashes'), irisG = $('iris'), pupilG = $('pupil'), shineG = $('shine');
  const GAZE_X = 26, GAZE_Y = 8;                  // max iris travel (SVG units)

  const eye = { o: 0, gx: 0, gy: 0, tx: 0, ty: 0, pupil: 1, dirty: true, active: false, raf: 0, last: 0 };

  // iris fibres + lashes (created once)
  (function buildEyeDetails() {
    const fibers = $('fibers');
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2 + rand(-0.04, 0.04);
      const r1 = 24 + rand(0, 4), r2 = 40 + rand(0, 14);
      svgEl('line', {
        class: 'thin',
        x1: (200 + Math.cos(a) * r1).toFixed(2), y1: (120 + Math.sin(a) * r1).toFixed(2),
        x2: (200 + Math.cos(a) * r2).toFixed(2), y2: (120 + Math.sin(a) * r2).toFixed(2),
        'stroke-opacity': (0.12 + Math.random() * 0.4).toFixed(2)
      }, fibers);
    }
  })();
  const LASH_T = [0.16, 0.26, 0.36, 0.46, 0.56, 0.66, 0.76, 0.85, 0.92];
  const lashEls = LASH_T.map(() => svgEl('line', {}, lashesG));

  // o: 0 (closed) → 1 (open). Redraws lids as quadratic curves.
  function updateLids() {
    const o = eye.o;
    const uy = 120 - 140 * o;      // upper lid control point
    const ly = 120 + 100 * o;      // lower lid control point
    const cy = 120 - 190 * o;      // crease control point
    const up = `M20 120 Q200 ${uy.toFixed(2)} 380 120`;
    const lo = `M20 120 Q200 ${ly.toFixed(2)} 380 120`;
    lidUpper.setAttribute('d', up);
    lidLower.setAttribute('d', lo);
    crease.setAttribute('d', `M48 112 Q200 ${cy.toFixed(2)} 352 112`);
    const shape = `M20 120 Q200 ${uy.toFixed(2)} 380 120 Q200 ${ly.toFixed(2)} 20 120Z`;
    clipShape.setAttribute('d', shape);
    eyeFill.setAttribute('d', shape);

    // lashes follow the upper lid curve
    for (let i = 0; i < LASH_T.length; i++) {
      const t = LASH_T[i], mt = 1 - t;
      const px = mt * mt * 20 + 2 * mt * t * 200 + t * t * 380;
      const py = mt * mt * 120 + 2 * mt * t * uy + t * t * 120;
      const tx = 2 * mt * 180 + 2 * t * 180;
      const ty = 2 * mt * (uy - 120) + 2 * t * (120 - uy);
      const len = Math.hypot(tx, ty) || 1;
      const nx = ty / len, ny = -tx / len;                // normal pointing up
      const L = (9 + 9 * t) * o;                           // longer towards the outer corner
      const l = lashEls[i];
      l.setAttribute('x1', px.toFixed(2));
      l.setAttribute('y1', py.toFixed(2));
      l.setAttribute('x2', (px + nx * L + (tx / len) * L * 0.35).toFixed(2));
      l.setAttribute('y2', (py + ny * L + (ty / len) * L * 0.35).toFixed(2));
    }
  }

  function renderEye(dt, now) {
    // smooth gaze (critically damped feel) + tiny living micro-drift
    const k = 1 - Math.exp(-dt * 8);
    const t = now / 1000;
    const j = 0.012 / view.zoom;
    eye.gx += (eye.tx + Math.sin(t * 1.7) * j - eye.gx) * k;
    eye.gy += (eye.ty + Math.cos(t * 1.3) * j - eye.gy) * k;

    const ix = (eye.gx * GAZE_X).toFixed(2), iy = (eye.gy * GAZE_Y).toFixed(2);
    irisG.setAttribute('transform', `translate(${ix} ${iy})`);
    shineG.setAttribute('transform', `translate(${(eye.gx * GAZE_X * 0.35).toFixed(2)} ${(eye.gy * GAZE_Y * 0.35).toFixed(2)})`);
    const ps = eye.pupil * (1 + 0.03 * Math.sin(t * 1.1));
    pupilG.setAttribute('transform', `translate(200 120) scale(${ps.toFixed(3)}) translate(-200 -120)`);

    if (eye.dirty) { updateLids(); eye.dirty = false; }
  }

  function eyeLoop(now) {
    if (!eye.active) return;
    const dt = Math.min(0.05, (now - eye.last) / 1000 || 0.016);
    eye.last = now;
    renderEye(dt, now);
    eye.raf = requestAnimationFrame(eyeLoop);
  }
  function startEyeLoop() {
    if (eye.active) return;
    eye.active = true;
    eye.last = performance.now();
    eye.raf = requestAnimationFrame(eyeLoop);
  }
  function stopEyeLoop() { eye.active = false; cancelAnimationFrame(eye.raf); }
  const setOpen = (v) => { eye.o = v; eye.dirty = true; };
  const lookAt = (x, y) => { eye.tx = x; eye.ty = y; };

  /* ------------------------------------------------------------------------
     Hearts: a small pool of particles drawn from pre-rendered glowing sprites
     ------------------------------------------------------------------------ */
  const Hearts = (() => {
    const ctx = canvas.getContext('2d');
    const SPR = 128, HALF = SPR / 2, SPR_K = SPR / 68;   // heart spans 68px inside the 128px sprite
    const PALETTE = [['#ff4d6d', 0.34], ['#ff8fa3', 0.26], ['#ffc2d1', 0.20], ['#ffffff', 0.20]];
    const MAX_FLY = 14, MAX_DRIFT = 54;
    const DAMP = 1.1;

    function makeSprite(color) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = SPR;
      const g = cv.getContext('2d');
      g.translate(HALF, HALF - 5);
      g.scale(34, 34);
      const p = new Path2D();
      p.moveTo(0, -0.35);
      p.bezierCurveTo(0, -0.9, -1, -0.9, -1, -0.25);
      p.bezierCurveTo(-1, 0.3, -0.4, 0.6, 0, 1);
      p.bezierCurveTo(0.4, 0.6, 1, 0.3, 1, -0.25);
      p.bezierCurveTo(1, -0.9, 0, -0.9, 0, -0.35);
      p.closePath();
      g.fillStyle = color;
      g.shadowColor = color; g.shadowBlur = 20; g.globalAlpha = 0.9;
      g.fill(p);                                         // glow
      g.shadowBlur = 0; g.globalAlpha = 1;
      g.fill(p);                                         // body
      const hl = g.createRadialGradient(-0.35, -0.35, 0, -0.35, -0.35, 1);
      hl.addColorStop(0, 'rgba(255,255,255,0.55)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = hl;
      g.fill(p);                                         // soft highlight
      return cv;
    }
    const sprites = PALETTE.map(([c]) => makeSprite(c));
    const pickSprite = () => {
      let r = Math.random(), acc = 0;
      for (let i = 0; i < PALETTE.length; i++) { acc += PALETTE[i][1]; if (r <= acc) return i; }
      return 0;
    };

    const pool = Array.from({ length: MAX_DRIFT + MAX_FLY }, () => ({ on: false }));
    let dpr = 1, W = 0, H = 0, cx = 0, cy = 0, u = 1, reach = 1;
    let capDrift = 30, rateD = 0, rateF = 0, accD = 0, accF = 0, countD = 0, countF = 0;
    let avoid = null, running = false, raf = 0, last = 0;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);   // cap DPR for mobile performance
      W = stage.clientWidth || window.innerWidth;
      H = stage.clientHeight || window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      cx = W / 2; cy = H / 2;
      u = clamp(Math.min(W, H) / 700, 0.55, 1.3);        // size unit
      reach = Math.hypot(W, H) / 1000;                   // speed unit
      capDrift = W * H < 500000 ? 30 : MAX_DRIFT;
      if (reduced) capDrift = Math.round(capDrift * 0.5);
    }

    function spawn(kind) {
      const p = pool.find((q) => !q.on);
      if (!p) return;
      p.on = true; p.kind = kind; p.age = 0; p.spr = pickSprite();
      p.ph1 = rand(0, 6.283); p.ph2 = rand(0, 6.283); p.fq = rand(0.35, 0.8);
      p.rot0 = rand(-0.5, 0.5);
      p.x = cx; p.y = cy;
      if (kind === 0) {                                  // drift: bursts out, then floats
        const a = rand(0, 6.283), depth = rand(0.55, 1.25);
        const sp = rand(300, 900) * reach * depth * (reduced ? 0.4 : 1);
        p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
        p.size = rand(11, 27) * u * depth;
        p.alpha = rand(0.5, 0.95) * (0.6 + 0.4 * depth);
      } else {                                           // fly: comes towards the viewer
        p.life = rand(2.4, 3.8);
        p.ang = rand(0, 6.283);
        p.dist = Math.hypot(W, H) * 0.5 * rand(0.65, 1.05);
        p.curve = rand(-120, 120) * u;
        p.size = rand(10, 20) * u;
        p.alpha = rand(0.6, 1);
        p.rotSp = rand(-1.2, 1.2);
      }
    }

    function put(p, size, alpha, rot, x, y) {
      if (alpha <= 0.01 || size < 0.5) return;
      const c = Math.cos(rot) * dpr, s = Math.sin(rot) * dpr;
      const w = size * SPR_K;
      ctx.globalAlpha = alpha;
      ctx.setTransform(c, s, -s, c, x * dpr, y * dpr);
      ctx.drawImage(sprites[p.spr], -w / 2, -w / 2, w, w);
    }

    function frame(now) {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;

      // spawning
      accD += rateD * dt; accF += rateF * dt;
      while (accD >= 1) { accD -= 1; if (countD < capDrift) { spawn(0); countD++; } }
      while (accF >= 1) { accF -= 1; if (countF < MAX_FLY) { spawn(1); countF++; } }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const damp = Math.exp(-dt * DAMP);
      const acc = 38 * u * (reduced ? 0.5 : 1);
      let nD = 0, nF = 0;

      // pass 1: drifting hearts (behind)
      for (const p of pool) {
        if (!p.on || p.kind !== 0) continue;
        nD++;
        p.age += dt;
        p.vx *= damp; p.vy *= damp;
        p.vx += Math.cos(p.age * p.fq + p.ph1) * acc * dt;
        p.vy += Math.sin(p.age * p.fq * 0.83 + p.ph2) * acc * dt;

        if (avoid) {                                     // gently flow around the name
          const nx = (p.x - avoid.cx) / avoid.rx, ny = (p.y - avoid.cy) / avoid.ry;
          const d = Math.hypot(nx, ny);
          if (d < 1) {
            const dx = p.x - avoid.cx, dy = p.y - avoid.cy, l = Math.hypot(dx, dy) || 1;
            const push = (1 - d) * 420 * u;
            p.vx += (dx / l) * push * dt; p.vy += (dy / l) * push * dt;
          }
        }
        p.x += p.vx * dt; p.y += p.vy * dt;

        const m = p.size * 0.5;                          // soft bounce at the screen edges
        if (p.x < m) { p.x = m; p.vx = Math.abs(p.vx) * 0.5; }
        else if (p.x > W - m) { p.x = W - m; p.vx = -Math.abs(p.vx) * 0.5; }
        if (p.y < m) { p.y = m; p.vy = Math.abs(p.vy) * 0.5; }
        else if (p.y > H - m) { p.y = H - m; p.vy = -Math.abs(p.vy) * 0.5; }

        const pop = 1 - Math.pow(1 - Math.min(1, p.age / 0.7), 3);
        const size = p.size * pop * (1 + 0.06 * Math.sin(p.age * p.fq * 2 + p.ph2));
        const a = p.alpha * Math.min(1, p.age / 0.6) * (0.82 + 0.18 * Math.sin(p.age * 1.4 + p.ph1));
        const rot = p.rot0 + Math.sin(p.age * 0.7 + p.ph1) * 0.35;
        put(p, size, a, rot, p.x, p.y);
      }

      // pass 2: hearts flying towards the viewer (in front)
      for (const p of pool) {
        if (!p.on || p.kind !== 1) continue;
        p.age += dt;
        const q = p.age / p.life;
        if (q >= 1) { p.on = false; continue; }
        nF++;
        const dist = p.dist * Math.pow(q, 1.9);
        const side = Math.sin(q * Math.PI) * p.curve;
        const ca = Math.cos(p.ang), sa = Math.sin(p.ang);
        const x = cx + ca * dist - sa * side, y = cy + sa * dist + ca * side;
        const size = p.size * (0.35 + 5 * Math.pow(q, 2.3));
        const a = p.alpha * smooth(0, 0.1, q) * (1 - smooth(0.6, 1, q));
        put(p, size, a, p.rot0 + p.rotSp * q, x, y);
      }
      countD = nD; countF = nF;
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }

    return {
      resize,
      start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); },
      stop() { running = false; cancelAnimationFrame(raf); },
      clear() {
        for (const p of pool) p.on = false;
        countD = countF = 0; accD = accF = 0; rateD = rateF = 0; avoid = null;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      },
      setRates(d, f) { rateD = d; rateF = reduced ? 0 : f; },
      setAvoid(zone) { avoid = zone; }
    };
  })();

  /* ------------------------------------------------------------------------
     Final scene helpers
     ------------------------------------------------------------------------ */
  function buildName() {
    nameEl.textContent = '';
    nameEl.setAttribute('aria-label', CONFIG.name);
    [...CONFIG.name].forEach((ch, i) => {
      const s = document.createElement('span');
      s.textContent = ch;
      s.setAttribute('aria-hidden', 'true');
      s.style.setProperty('--i', (0.5 + i * 0.14).toFixed(2) + 's');
      nameEl.appendChild(s);
    });
  }

  function buildTagline() {
    if (CONFIG.tagline == null) return;               // keep HTML default
    taglineEl.textContent = '';
    taglineEl.hidden = CONFIG.tagline === '';
    CONFIG.tagline.split('♡').forEach((part, i, arr) => {
      taglineEl.append(part);
      if (i < arr.length - 1) {
        const h = document.createElement('span');
        h.className = 'tag-heart';
        h.textContent = '♡';
        taglineEl.append(h);
      }
    });
  }

  // keeps hearts from covering the name too much
  function updateAvoidZone() {
    const r = finalInner.getBoundingClientRect();
    const pad = 28;
    Hearts.setAvoid({
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      rx: r.width / 2 + pad,
      ry: r.height / 2 + pad
    });
  }

  /* ------------------------------------------------------------------------
     Scene reset (used before every play)
     ------------------------------------------------------------------------ */
  function resetScene() {
    stage.classList.add('resetting');
    stage.classList.remove('running', 'finale', 'done');
    linesSvg.classList.remove('on', 'out');
    eyeSvg.classList.remove('drawn');
    camera.classList.remove('hide');
    glow.classList.remove('beat');
    finalEl.classList.remove('show');
    ambient.classList.remove('on');

    Hearts.stop();
    Hearts.clear();

    eye.o = 0; eye.gx = eye.gy = eye.tx = eye.ty = 0; eye.pupil = 1; eye.dirty = true;
    view.zoom = 1;
    applyViews();
    renderEye(0.016, performance.now());

    void stage.offsetWidth;                            // flush styles, then re-enable transitions
    stage.classList.remove('resetting');
  }

  const fontsReady = () => Promise.race([
    (document.fonts && document.fonts.ready) || Promise.resolve(),
    new Promise((r) => setTimeout(r, 1500))
  ]);

  function finalZoom() {
    const ke = view.eyeW / 400;
    const pupilPx = 44 * ke * 1.16;                    // pupil diameter at max dilation
    return (Math.hypot(view.w, view.h) * 1.08) / pupilPx;
  }

  /* ------------------------------------------------------------------------
     THE TIMELINE — every scene starts after the previous one is finished
     ------------------------------------------------------------------------ */
  async function blink(id) {
    await tween(140, ease.inQuad, (e) => setOpen(1 - e), id);
    await sleep(50, id);
    await tween(260, ease.outQuad, (e) => setOpen(e), id);
  }

  async function play() {
    const id = ++runId;
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    try {
      resetScene();
      layout();
      await fontsReady();
      await sleep(400, id);
      stage.classList.add('running');
      startEyeLoop();

      /* Scene 1 — thin lines draw in from all sides */
      linesSvg.classList.add('on');
      await sleep(2600, id);

      /* Scene 2 — the eye draws itself (closed), then slowly opens */
      eyeSvg.classList.add('drawn');
      await sleep(2300, id);
      await tween(2300, ease.inOutCubic, (e) => setOpen(e), id);
      await sleep(500, id);

      // pupil looks around
      lookAt(-0.75, -0.1);  await sleep(1000, id);
      lookAt(0.8, 0.12);    await sleep(1000, id);
      lookAt(0, 0);         await sleep(700, id);

      // natural blink
      await blink(id);
      await sleep(900, id);

      /* Scene 3 — lines fade, camera dollies in, zoom into the pupil */
      linesSvg.classList.add('out');
      lookAt(0, 0);
      const zEnd = finalZoom();
      const lnZ = Math.log(zEnd);

      if (reduced) {
        // no zoom: gentle cross-fade instead
        camera.classList.add('hide');
        await sleep(1600, id);
      } else {
        await tween(CONFIG.zoomMs, ease.zoom, (e) => {
          view.zoom = Math.exp(lnZ * e);
          eye.pupil = 1 + 0.16 * e;                    // pupil dilates
          applyViews();
        }, id);
        camera.classList.add('hide');
      }
      stopEyeLoop();

      /* Scene 4 — hearts pour out of the pupil */
      glow.classList.add('beat');
      Hearts.start();
      await sleep(900, id);
      await tween(6500, ease.linear, (e) => {
        Hearts.setRates(lerp(4, 18, e), lerp(1.2, 5, e));
      }, id);
      Hearts.setRates(0, 0);                           // fly-by hearts finish naturally
      await sleep(600, id);

      /* Scene 5 — the name appears */
      stage.classList.add('finale');
      ambient.classList.add('on');
      finalEl.classList.add('show');
      updateAvoidZone();
      await sleep(4200, id);

      /* Scene 6 — replay button */
      stage.classList.add('done');
    } catch (err) {
      if (!(err instanceof Cancel)) console.error(err);
    }
  }

  /* ------------------------------------------------------------------------
     Init
     ------------------------------------------------------------------------ */
  let resizeRaf = 0;
  const onResize = () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(layout);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  replayBtn.addEventListener('click', () => play());

  buildLines();
  buildName();
  buildTagline();
  layout();
  play();
})();
