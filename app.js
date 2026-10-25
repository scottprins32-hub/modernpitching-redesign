// ModernPitching redesign: language switch, nav, and the delivery scrubber.
// The scrubber follows the rules of a fluid interface: it responds on
// pointer-down, tracks 1:1 from the grab point, can be grabbed mid-flight,
// projects momentum on release, hands the release velocity to a spring,
// and rubber-bands at the ends. Reduced motion gets instant frames.

import { PHASES, KEYFRAMES, poseAt, figureSvg } from './poses.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* ---------------- Language ---------------- */
const LANG_KEY = 'mp-lang';
const html = document.documentElement;

function applyLang(lang) {
  const nl = lang === 'nl';
  html.lang = lang;
  html.dataset.lang = lang;
  document.querySelectorAll('[data-nl]').forEach((el) => {
    if (el.dataset.en === undefined) el.dataset.en = el.textContent;
    el.textContent = nl ? el.dataset.nl : el.dataset.en;
  });
  document.querySelectorAll('[data-nl-label]').forEach((el) => {
    if (el.dataset.enLabel === undefined) el.dataset.enLabel = el.getAttribute('aria-label') || '';
    el.setAttribute('aria-label', nl ? el.dataset.nlLabel : el.dataset.enLabel);
  });
  document.querySelectorAll('[data-nl-href]').forEach((el) => {
    if (el.dataset.enHref === undefined) el.dataset.enHref = el.getAttribute('href');
    el.setAttribute('href', nl ? el.dataset.nlHref : el.dataset.enHref);
  });
  document.querySelectorAll('[data-set-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setLang === lang)));
  document.title = nl ? 'ModernPitching. Gooi harder, in de juiste volgorde.' : 'ModernPitching. Throw harder, in the right order.';
  try { localStorage.setItem(LANG_KEY, lang); } catch {}
  scrub?.refreshLabels();
}

function initialLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'nl' || q === 'en') return q;
  try { const s = localStorage.getItem(LANG_KEY); if (s === 'nl' || s === 'en') return s; } catch {}
  return 'en';
}

document.querySelectorAll('[data-set-lang]').forEach((b) => b.addEventListener('click', () => applyLang(b.dataset.setLang)));

/* ---------------- Nav ---------------- */
const nav = document.querySelector('.nav');
const toggle = document.querySelector('.nav__toggle');
const menu = document.getElementById('menu');
let scrolledRaf = 0;
// The bar is a material: translucent black over the dark bands, translucent
// white over the lab sheet, opaque black over the orange call. It reads the
// band directly beneath its bottom edge.
function updateBar() {
  nav.classList.toggle('is-scrolled', scrollY > 8);
  const y = nav.getBoundingClientRect().bottom + 1;
  const under = document.elementFromPoint(Math.min(innerWidth - 1, 24), y)?.closest('[data-bar]');
  const bar = under?.dataset.bar || 'dark';
  nav.classList.toggle('is-light', bar === 'light');
  nav.classList.toggle('is-solid', bar === 'solid');
}
addEventListener('scroll', () => {
  if (scrolledRaf) return;
  scrolledRaf = requestAnimationFrame(() => { updateBar(); scrolledRaf = 0; });
}, { passive: true });
addEventListener('resize', updateBar);
addEventListener('scrollend', updateBar);
updateBar();

toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  menu.classList.toggle('is-open', open);
});
menu?.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => {
  toggle.setAttribute('aria-expanded', 'false');
  menu.classList.remove('is-open');
}));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menu.classList.contains('is-open')) { toggle.setAttribute('aria-expanded', 'false'); menu.classList.remove('is-open'); toggle.focus(); }
});

/* ---------------- Spring ----------------
   Apple's two parameters: damping ratio and response (seconds). */
class Spring {
  constructor(value) { this.x = value; this.v = 0; this.target = value; this.running = false; this.onUpdate = null; this.onRest = null; }
  set(value) { this.x = value; this.v = 0; this.target = value; this.stop(); this.onUpdate?.(this.x); }
  to(target, { response = 0.4, damping = 1, velocity } = {}) {
    this.target = target; this.response = response; this.damping = damping;
    if (velocity !== undefined) this.v = velocity;        // velocity handoff from the gesture
    if (!this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame(this.tick); }
  }
  stop() { this.running = false; }
  tick = (now) => {
    if (!this.running) return;
    let dt = Math.min((now - this.last) / 1000, 1 / 30); this.last = now;
    const omega = (2 * Math.PI) / this.response;          // stiffness from response
    const k = omega * omega, c = 2 * this.damping * omega;
    // semi-implicit Euler in 4 substeps keeps it stable under heavy frames
    for (let i = 0; i < 4; i++) {
      const h = dt / 4;
      const a = -k * (this.x - this.target) - c * this.v;
      this.v += a * h; this.x += this.v * h;
    }
    const settled = Math.abs(this.x - this.target) < 0.0015 && Math.abs(this.v) < 0.01;
    if (settled) { this.x = this.target; this.v = 0; this.running = false; this.onUpdate?.(this.x); this.onRest?.(); return; }
    this.onUpdate?.(this.x);
    requestAnimationFrame(this.tick);
  };
}

/* ---------------- Scrubber ---------------- */
const LAST = KEYFRAMES.length - 1;
// Apple's momentum projection: where a flick would come to rest.
const project = (v, d = 0.998) => (v / 1000) * d / (1 - d);
// Progressive resistance past a boundary.
const rubberband = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));

function makeScrubber() {
  const stage = document.querySelector('.scrub__stage');
  if (!stage) return null;
  const figure = document.getElementById('scrub-figure');
  const fill = document.getElementById('scrub-fill');
  const thumb = document.getElementById('scrub-thumb');
  const num = document.getElementById('scrub-num');
  const phaseEl = document.getElementById('scrub-phase');
  const buttons = [...document.querySelectorAll('.scrub__phases button')];
  const replay = document.getElementById('scrub-replay');

  const spring = new Spring(LAST);
  let shown = -1;        // nearest phase currently shown in the readout
  let dragging = false, grabX = 0, grabVal = 0, trackPx = 1;
  let touched = false;   // once the visitor has taken the controls, the intro stays out of the way
  let history = [];      // [{t, x}] last few pointer samples for velocity

  // The track width in px is the unit for projection and velocity.
  const measure = () => { trackPx = Math.max(stage.getBoundingClientRect().width * 0.78, 200); };
  measure(); addEventListener('resize', measure);

  const label = (i) => PHASES[i][html.lang === 'nl' ? 'nl' : 'en'];

  function render(p) {
    const c = Math.min(Math.max(p, 0), LAST);
    const near = Math.round(c);
    const dist = Math.abs(c - near);                      // 0 at a keyframe, .5 between
    const markerOpacity = Math.max(0, 1 - dist * 2.4);
    figure.innerHTML = figureSvg(poseAt(c), near, markerOpacity);
    const frac = c / LAST;
    fill.style.transform = `scaleX(${frac})`;
    thumb.style.left = `${frac * 100}%`;
    if (near !== shown) {
      shown = near;
      num.textContent = String(near + 1).padStart(2, '0');
      phaseEl.textContent = label(near);
      buttons.forEach((b, i) => (i === near ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
      stage.setAttribute('aria-valuenow', String(near));
      stage.setAttribute('aria-valuetext', label(near));
    }
  }
  spring.onUpdate = render;

  function goTo(i, opts = {}) {
    i = Math.min(Math.max(i, 0), LAST);
    if (reduceMotion.matches) { spring.set(i); return; }
    spring.to(i, { response: 0.42, damping: 1, ...opts });  // from the current value, carrying velocity
  }

  // Pointer: 1:1 from the grab point, capture so it keeps tracking off the stage.
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    touched = true; dragging = true;
    try { stage.setPointerCapture(e.pointerId); } catch {}
    stage.classList.add('is-grabbing');
    spring.stop();                                         // grab it mid-flight
    grabX = e.clientX; grabVal = spring.x;                 // respect where they grabbed
    history = [{ t: e.timeStamp, x: e.clientX }];
    stage.focus({ preventScroll: true });
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - grabX;
    let p = grabVal + (dx / trackPx) * LAST;
    if (p < 0) p = rubberband(p, 1);
    else if (p > LAST) p = LAST + rubberband(p - LAST, 1);
    spring.x = p; render(p);
    history.push({ t: e.timeStamp, x: e.clientX });
    if (history.length > 6) history.shift();
  });
  const release = (e) => {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('is-grabbing');
    // velocity over the last ~80ms of samples, in px/s
    const now = e.timeStamp;
    const recent = history.filter((s) => now - s.t <= 100);
    // Held still before letting go: no velocity, whatever happened earlier.
    const a = recent[0], b = recent[recent.length - 1];
    const vPx = recent.length >= 2 && b.t > a.t ? ((b.x - a.x) / (b.t - a.t)) * 1000 : 0;
    const vUnits = (vPx / trackPx) * LAST;                 // phase units per second
    const projected = spring.x + (project(vPx) / trackPx) * LAST;
    const target = Math.round(Math.min(Math.max(projected, 0), LAST));
    const flick = Math.abs(vPx) > 350;
    goTo(target, { velocity: vUnits, damping: flick ? 0.8 : 1, response: 0.4 });
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  // The rail is a slider too: absolute position along it, snap on release.
  const track = document.querySelector('.scrub__track');
  let railDrag = false;
  const railValue = (clientX) => {
    const r = track.querySelector('.scrub__rail').getBoundingClientRect();
    return Math.min(Math.max((clientX - r.left) / r.width, 0), 1) * LAST;
  };
  track.addEventListener('pointerdown', (e) => {
    touched = true; railDrag = true; try { track.setPointerCapture(e.pointerId); } catch {} spring.stop();
    spring.x = railValue(e.clientX); render(spring.x);
  });
  track.addEventListener('pointermove', (e) => { if (railDrag) { spring.x = railValue(e.clientX); render(spring.x); } });
  const railRelease = () => { if (!railDrag) return; railDrag = false; goTo(Math.round(spring.x), { response: 0.3 }); };
  track.addEventListener('pointerup', railRelease);
  track.addEventListener('pointercancel', railRelease);

  // Keyboard: step, Home/End, and the phase buttons.
  stage.addEventListener('keydown', (e) => {
    touched = true;
    const cur = Math.round(spring.target);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); goTo(cur + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); goTo(cur - 1); }
    else if (e.key === 'Home') { e.preventDefault(); goTo(0); }
    else if (e.key === 'End') { e.preventDefault(); goTo(LAST); }
  });
  buttons.forEach((b) => b.addEventListener('click', () => { touched = true; goTo(Number(b.dataset.phase)); }));

  // A finite introduction: step through the delivery once, then rest at release.
  let introTimers = [];
  function play() {
    introTimers.forEach(clearTimeout); introTimers = [];
    if (reduceMotion.matches) { spring.set(LAST); return; }
    spring.set(0);
    const beat = 520;
    for (let i = 1; i <= LAST; i++) introTimers.push(setTimeout(() => { if (!dragging) spring.to(i, { response: 0.55, damping: 1 }); }, 260 + (i - 1) * beat));
  }
  replay?.addEventListener('click', play);
  stage.addEventListener('pointerdown', () => { introTimers.forEach(clearTimeout); introTimers = []; });

  render(LAST);
  // Play once when the stage is actually on screen.
  if (!reduceMotion.matches && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) { io.disconnect(); if (!touched) play(); }
    }, { threshold: 0.5 });
    io.observe(stage);
  }

  return { refreshLabels() { shown = -1; render(spring.x); } };
}

const scrub = makeScrubber();
applyLang(initialLang());
