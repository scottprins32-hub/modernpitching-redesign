// Shared by the browser (hero scrubber) and the build step (static frames).
// Four keyframes of a right-handed delivery, side view, plate to the right.
// Coordinates live in a 240 x 260 box; the mound line is y = 228.
// These are authored stick figures in the style of the app's pose overlay,
// not measured data from a specific athlete.

export const PHASES = [
  { id: 'load',       en: 'Load',       nl: 'Load' },
  { id: 'footstrike',  en: 'Foot strike', nl: 'Foot strike' },
  { id: 'armpath',    en: 'Arm path',   nl: 'Arm path' },
  { id: 'release',    en: 'Release',    nl: 'Release' },
];

// joint order: head, neck, shoR, elbR, wriR, shoL, elbL, wriL, hip, kneeB, ankB, kneeF, ankF
export const JOINTS = ['head','neck','shoR','elbR','wriR','shoL','elbL','wriL','hip','kneeB','ankB','kneeF','ankF'];

export const KEYFRAMES = [
  // 01 Load: peak leg lift, hips hinged back over the rubber
  { head:[106,66], neck:[104,88], shoR:[100,92], elbR:[82,112], wriR:[100,124],
    shoL:[108,92], elbL:[124,112], wriL:[104,124], hip:[90,142],
    kneeB:[97,186], ankB:[100,228], kneeF:[120,134], ankF:[114,174] },
  // 02 Separation: foot strike, pelvis open, shoulders still closed
  { head:[128,74], neck:[128,96], shoR:[124,98], elbR:[102,88], wriR:[92,62],
    shoL:[134,98], elbL:[158,96], wriL:[180,92], hip:[128,148],
    kneeB:[112,190], ankB:[100,228], kneeF:[164,190], ankF:[176,228] },
  // 03 Arm path: trunk turning, elbow at shoulder height, forearm laid back behind the head
  { head:[148,74], neck:[146,96], shoR:[142,98], elbR:[118,96], wriR:[94,90],
    shoL:[150,98], elbL:[162,116], wriL:[146,122], hip:[142,150],
    kneeB:[120,192], ankB:[104,226], kneeF:[168,188], ankF:[178,228] },
  // 04 Release: front leg blocks, trunk over it, arm out front
  { head:[186,90], neck:[178,106], shoR:[174,108], elbR:[198,96], wriR:[216,86],
    shoL:[180,108], elbL:[186,128], wriL:[168,128], hip:[158,152],
    kneeB:[126,194], ankB:[98,222], kneeF:[178,190], ankF:[184,228] },
];

export const BONES = [
  ['neck','hip'], ['shoR','elbR'], ['elbR','wriR'], ['shoL','elbL'], ['elbL','wriL'],
  ['hip','kneeB'], ['kneeB','ankB'], ['hip','kneeF'], ['kneeF','ankF'], ['neck','shoR'], ['neck','shoL'],
];

// Parent → child segments, parents first. Interpolating joint positions
// directly shortens a limb whenever it rotates (the chord of the arc), so
// each segment is interpolated by angle and length from its parent instead,
// and the pose is rebuilt by forward kinematics from the hip.
const SEGMENTS = [
  ['hip','neck'], ['neck','head'],
  ['neck','shoR'], ['shoR','elbR'], ['elbR','wriR'],
  ['neck','shoL'], ['shoL','elbL'], ['elbL','wriL'],
  ['hip','kneeB'], ['kneeB','ankB'], ['hip','kneeF'], ['kneeF','ankF'],
];
const lerp = (a, b, t) => a + (b - a) * t;
export function lerpPose(a, b, t) {
  const out = { hip: [lerp(a.hip[0], b.hip[0], t), lerp(a.hip[1], b.hip[1], t)] };
  for (const [par, ch] of SEGMENTS) {
    const ax = a[ch][0] - a[par][0], ay = a[ch][1] - a[par][1];
    const bx = b[ch][0] - b[par][0], by = b[ch][1] - b[par][1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    const aa = Math.atan2(ay, ax), ab = Math.atan2(by, bx);
    let d = ab - aa;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const ang = aa + d * t, len = lerp(la, lb, t);
    out[ch] = [out[par][0] + Math.cos(ang) * len, out[par][1] + Math.sin(ang) * len];
  }
  return out;
}

// p in [0, 3]
export function poseAt(p) {
  const c = Math.min(Math.max(p, 0), KEYFRAMES.length - 1);
  const i = Math.min(Math.floor(c), KEYFRAMES.length - 2);
  return lerpPose(KEYFRAMES[i], KEYFRAMES[i + 1], c - i);
}

// The measured thing in each frame, drawn in the accent colour.
export function markerSvg(phase, P) {
  const f = (n) => n.toFixed(1);
  switch (phase) {
    case 0: { // hip hinge: dashed plumb line from the back ankle, tick at hip height
      const x = P.ankB[0], hy = P.hip[1];
      return `<line class="mk" x1="${f(x)}" y1="${f(hy - 10)}" x2="${f(x)}" y2="228" stroke-dasharray="3 5"/>
        <line class="mk" x1="${f(P.hip[0])}" y1="${f(hy)}" x2="${f(x)}" y2="${f(hy)}"/>
        <circle class="mk-dot" cx="${f(P.hip[0])}" cy="${f(hy)}" r="3.2"/>`;
    }
    case 1: { // stride and trunk position at foot strike
      const y = 244;
      return `<line class="mk" x1="${f(P.ankB[0])}" y1="${y}" x2="${f(P.ankF[0])}" y2="${y}"/>
        <line class="mk" x1="${f(P.ankB[0])}" y1="${y - 5}" x2="${f(P.ankB[0])}" y2="${y + 5}"/>
        <line class="mk" x1="${f(P.ankF[0])}" y1="${y - 5}" x2="${f(P.ankF[0])}" y2="${y + 5}"/>
        <line class="mk" x1="${f(P.hip[0])}" y1="${f(P.hip[1])}" x2="${f(P.hip[0])}" y2="${y - 8}" stroke-dasharray="3 5"/>`;
    }
    case 2: { // elbow angle as the arm lays back
      const [ex, ey] = P.elbR, [sx, sy] = P.shoR, [wx, wy] = P.wriR;
      const u = norm(sx - ex, sy - ey), v = norm(wx - ex, wy - ey), r = 14;
      const a1 = Math.atan2(u[1], u[0]), a2 = Math.atan2(v[1], v[0]);
      let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      const sweep = d > 0 ? 1 : 0;
      const p1 = [ex + u[0] * r, ey + u[1] * r], p2 = [ex + v[0] * r, ey + v[1] * r];
      return `<path class="mk" d="M${f(p1[0])} ${f(p1[1])} A${r} ${r} 0 0 ${sweep} ${f(p2[0])} ${f(p2[1])}"/>
        <circle class="mk-dot" cx="${f(ex)}" cy="${f(ey)}" r="3.2"/>`;
    }
    default: { // front-leg block and the release point
      const x = P.ankF[0];
      return `<line class="mk" x1="${f(x)}" y1="${f(P.hip[1] - 6)}" x2="${f(x)}" y2="228" stroke-dasharray="3 5"/>
        <circle class="mk-ring" cx="${f(P.wriR[0] + 5)}" cy="${f(P.wriR[1] - 2)}" r="7"/>`;
    }
  }
}

function norm(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }

export function figureSvg(P, phase, markerOpacity = 1) {
  const f = (n) => n.toFixed(1);
  const bones = BONES.map(([a, b]) => `<line x1="${f(P[a][0])}" y1="${f(P[a][1])}" x2="${f(P[b][0])}" y2="${f(P[b][1])}"/>`).join('');
  const joints = JOINTS.filter((j) => j !== 'head').map((j) => `<circle cx="${f(P[j][0])}" cy="${f(P[j][1])}" r="2.6"/>`).join('');
  return `<g class="ground"><line x1="34" y1="228" x2="236" y2="228"/><rect x="92" y="226" width="16" height="3"/></g>
    <g class="bones">${bones}</g>
    <g class="joints">${joints}</g>
    <circle class="head" cx="${f(P.head[0])}" cy="${f(P.head[1])}" r="11"/>
    <g class="marker" style="opacity:${markerOpacity}">${markerSvg(phase, P)}</g>`;
}
