import type { AvatarFrame } from "./controller.js";
import { delaunay } from "./delaunay.js";
import { FACE_MESH_TRIANGLES } from "./faceMeshTriangles.js";

/**
 * Animates a single portrait photo: MediaPipe's 478 face landmarks plus rings of
 * helper points become a triangle mesh, and each frame moves those points (jaw,
 * lips, lids, brows, head turn) while the photo stays mapped to the rest
 * positions. Pure math so it can be tested; the stage renders it with WebGL.
 */

// MediaPipe Face Mesh landmark indices.
const UPPER_INNER = [191, 80, 81, 82, 13, 312, 311, 310, 415];
const LOWER_INNER = [95, 88, 178, 87, 14, 317, 402, 318, 324];
const INNER_CORNERS = [78, 308];
const INNER_LIP = [78, ...UPPER_INNER, 308, ...LOWER_INNER];
/** Inner mouth outline in drawing order (upper lip left→right, lower lip right→left). */
const INNER_RING = [78, ...UPPER_INNER, 308, ...[...LOWER_INNER].reverse()];
const UPPER_OUTER = [185, 40, 39, 37, 0, 267, 269, 270, 409];
const LOWER_OUTER = [146, 91, 181, 84, 17, 314, 405, 321, 375];
const MOUTH_CORNERS = [61, 291];
const LIP_POINTS = new Set([...INNER_LIP, ...UPPER_OUTER, ...LOWER_OUTER, ...MOUTH_CORNERS]);
const EYES = [
  { upper: [246, 161, 160, 159, 158, 157, 173], lower: [7, 163, 144, 145, 153, 154, 155], crease: [247, 30, 29, 27, 28, 56, 190], iris: [468, 469, 470, 471, 472] },
  { upper: [466, 388, 387, 386, 385, 384, 398], lower: [249, 390, 373, 374, 380, 381, 382], crease: [467, 260, 259, 257, 258, 286, 414], iris: [473, 474, 475, 476, 477] },
];
const BROWS = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46, 300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const CHIN = 152;
const FOREHEAD = 10;
const EYE_OUTER = [33, 263];

export const LANDMARK_COUNT = 478;

function insidePolygon(x: number, y: number, poly: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface PhotoPose {
  /** 0 closed .. 1 wide open */
  jaw: number;
  /** -0.5 narrow (oo) .. 0.3 wide (ee) */
  width: number;
  smile: number;
  browRaise: number;
  eyeOpenL: number;
  eyeOpenR: number;
  gazeX: number;
  gazeY: number;
  /** degrees */
  yaw: number;
  pitch: number;
  roll: number;
  /** px in image space */
  sway: number;
  breath: number;
}

export const NEUTRAL_PHOTO_POSE: PhotoPose = { jaw: 0, width: 0, smile: 0, browRaise: 0, eyeOpenL: 1, eyeOpenR: 1, gazeX: 0, gazeY: 0, yaw: 0, pitch: 0, roll: 0, sway: 0, breath: 0 };

const MOUTH: Record<string, { w: number; h: number; round: number }> = {
  rest: { w: 1, h: 0.1, round: 0 },
  A: { w: 1.05, h: 1, round: 0.2 },
  E: { w: 1.2, h: 0.6, round: 0 },
  I: { w: 1.25, h: 0.38, round: 0 },
  O: { w: 0.75, h: 0.85, round: 1 },
  U: { w: 0.6, h: 0.5, round: 1 },
  MBP: { w: 0.95, h: 0.04, round: 0 },
  FV: { w: 1.05, h: 0.18, round: 0 },
  TH: { w: 1.05, h: 0.32, round: 0 },
  CH: { w: 0.85, h: 0.42, round: 0.6 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The cartoon controller's frame, translated into what a photo can do believably (small head turns). */
export function poseFromFrame(f: AvatarFrame): PhotoPose {
  const m = MOUTH[f.viseme] ?? MOUTH.rest!;
  const open = f.speaking ? clamp(f.mouthOpen, 0, 1) : 0;
  return {
    jaw: clamp(open * (0.25 + 0.75 * m.h), 0, 1),
    width: clamp((m.w - 1) * open - 0.15 * m.round * open, -0.5, 0.3),
    smile: clamp(f.face.smile, -1, 1),
    browRaise: clamp(f.face.browRaise, -1, 1),
    eyeOpenL: clamp(f.eyeOpenL, 0, 1.15),
    eyeOpenR: clamp(f.eyeOpenR, 0, 1.15),
    gazeX: clamp(f.gazeX, -1, 1),
    gazeY: clamp(f.gazeY, -1, 1),
    yaw: clamp(f.headYaw * 0.7, -6, 6),
    pitch: clamp(f.headPitch * 0.6, -5, 5),
    roll: clamp(f.headRoll * 0.6, -5, 5),
    sway: f.bodySway * 0.3,
    breath: clamp(f.breath, 0, 1),
  };
}

export interface PhotoRig {
  /** Rest positions in image pixels, [x0, y0, x1, y1, ...]. */
  rest: Float32Array;
  /** Texture coordinates 0..1. */
  uv: Float32Array;
  triangles: Uint16Array;
  vertexCount: number;
  /** Interocular distance in px; the unit for every movement. */
  unit: number;
  faceBox: { cx: number; cy: number; w: number; h: number };
  /** The source photo already shows the inside of the mouth. */
  openPhoto: boolean;
  deform(pose: PhotoPose): Float32Array;
  /** Dark mouth cavity and teeth for the current (deformed) positions, as coloured triangles. */
  mouth(pos: Float32Array): { positions: number[]; colors: number[] };
}

export function buildPhotoRig(landmarks: ArrayLike<number>, width: number, height: number): PhotoRig {
  if (landmarks.length < LANDMARK_COUNT * 3) throw new Error("ต้องมีจุดใบหน้า 478 จุด");
  const L = (i: number): [number, number, number] => [landmarks[i * 3]! * width, landmarks[i * 3 + 1]! * height, landmarks[i * 3 + 2]! * width];

  const eyeA = L(EYE_OUTER[0]!);
  const eyeB = L(EYE_OUTER[1]!);
  const D = Math.hypot(eyeA[0] - eyeB[0], eyeA[1] - eyeB[1]);
  const oval = FACE_OVAL.map(L);
  const ox = oval.map((p) => p[0]);
  const oy = oval.map((p) => p[1]);
  const face = { cx: (Math.min(...ox) + Math.max(...ox)) / 2, cy: (Math.min(...oy) + Math.max(...oy)) / 2, w: Math.max(...ox) - Math.min(...ox), h: Math.max(...oy) - Math.min(...oy) };
  const chin = L(CHIN);
  const forehead = L(FOREHEAD);
  const corners = MOUTH_CORNERS.map(L);
  const mouthC = [(corners[0]![0] + corners[1]![0]) / 2, (L(13)[1] + L(14)[1]) / 2] as const;
  const mouthHalfW = Math.abs(corners[1]![0] - corners[0]![0]) / 2 || D * 0.4;

  // ---- vertices: landmarks, two rings around the face, then a sparse grid over the photo ----
  const pts: [number, number][] = [];
  const z: number[] = [];
  /** How much each vertex follows the head (1 face .. 0 background/body). */
  const headW: number[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const p = L(i);
    pts.push([p[0], p[1]]);
    z.push(p[2]);
    headW.push(1);
  }
  const tooClose = (x: number, y: number, min: number) => pts.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < min * min);
  const inImage = (x: number, y: number) => x >= 0 && y >= 0 && x <= width && y <= height;
  const add = (x: number, y: number, w: number, depth: number, min: number) => {
    x = clamp(x, 0, width);
    y = clamp(y, 0, height);
    if (tooClose(x, y, min)) return;
    pts.push([x, y]);
    z.push(depth);
    headW.push(w);
  };
  for (const [scale, w] of [[1.18, 0.9], [1.45, 0.6], [1.8, 0.3]] as const) {
    for (const p of oval) {
      const x = face.cx + (p[0] - face.cx) * scale;
      // Rings below the chin hug the neck rather than spreading wide.
      const below = p[1] > face.cy;
      const y = face.cy + (p[1] - face.cy) * (below ? 1 + (scale - 1) * 0.6 : scale);
      if (inImage(x, y)) add(x, y, below ? w * 0.6 : w, face.w * 0.3, D * 0.18);
    }
  }
  const cols = 8;
  const rows = Math.max(6, Math.round((cols * height) / width));
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const x = (c / cols) * width;
      const y = (r / rows) * height;
      const edge = r === 0 || c === 0 || r === rows || c === cols;
      const dist = Math.hypot((x - face.cx) / (face.w * 0.5), (y - face.cy) / (face.h * 0.5));
      const w = edge ? 0 : clamp(1.6 - dist * 0.45, 0, 0.25) * (y > chin[1] ? 0.4 : 1);
      add(x, y, w, face.w * 0.3, edge ? 1 : D * 0.35);
    }
  }
  const n = pts.length;

  // ---- per-vertex weights for each movement ----
  const jawW = new Float32Array(n);
  const upperLipW = new Float32Array(n);
  const mouthWideW = new Float32Array(n);
  const smileW = new Float32Array(n);
  const browW = new Float32Array(n);
  const below = (y: number) => clamp((y - mouthC[1] + D * 0.02) / (D * 0.12), 0, 1);
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i]!;
    const dx = (x - mouthC[0]) / (face.w * 0.42);
    let jw = below(y) * Math.exp(-dx * dx);
    if (y > chin[1]) jw *= Math.exp(-(((y - chin[1]) / (D * 0.35)) ** 2));
    if (i >= LANDMARK_COUNT) jw *= 0.8;
    jawW[i] = jw;
    const dm = Math.hypot(x - mouthC[0], y - mouthC[1]) / D;
    mouthWideW[i] = Math.exp(-((dm / 0.55) ** 2));
    smileW[i] = Math.max(...corners.map((c) => Math.exp(-((Math.hypot(x - c[0], y - c[1]) / (D * 0.38)) ** 2))));
    const db = Math.min(...BROWS.map((b) => Math.hypot(x - pts[b]![0], y - pts[b]![1]))) / D;
    browW[i] = y < L(168)[1] ? Math.exp(-((db / 0.3) ** 2)) : 0;
  }
  // Every landmark on a lip (MediaPipe has several rings per lip) moves with that lip,
  // otherwise the middle rings lag behind and the lip texture smears.
  const lowerLip = [61, ...LOWER_OUTER, 291, 308, ...[...LOWER_INNER].reverse(), 78].map((i) => pts[i]!);
  const upperLip = [61, ...UPPER_OUTER, 291, 308, ...[...UPPER_INNER].reverse(), 78].map((i) => pts[i]!);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const [x, y] = pts[i]!;
    if (insidePolygon(x, y, lowerLip)) jawW[i] = 1;
    else if (insidePolygon(x, y, upperLip)) {
      jawW[i] = 0;
      upperLipW[i] = 1;
    }
  }
  for (const i of [...LOWER_INNER, ...LOWER_OUTER]) jawW[i] = 1;
  for (const i of [...UPPER_INNER, ...UPPER_OUTER]) {
    jawW[i] = 0;
    upperLipW[i] = 1;
  }
  for (const i of [...INNER_CORNERS, ...MOUTH_CORNERS]) jawW[i] = 0.5;
  for (const i of BROWS) browW[i] = 1;

  // Lid closing vectors: each upper-lid point travels to its lower-lid partner.
  const lid = EYES.map((e) => ({
    pairs: e.upper.map((u, k) => [u, e.lower[k]!] as const),
    crease: e.crease,
    iris: e.iris,
  }));

  // ---- triangles ----
  // The face uses MediaPipe's own mesh, which leaves the mouth opening empty; the rest of
  // the photo (hair, neck, body, background) is a Delaunay mesh around the face outline.
  const restGap = Math.max(...UPPER_INNER.map((u, k) => pts[LOWER_INNER[k]!]![1] - pts[u]![1]));
  // A photo that already shows teeth keeps its own mouth (stretched as it opens);
  // a closed-mouth photo gets a drawn mouth interior behind the opening.
  const openPhoto = restGap > D * 0.04;
  const tris: [number, number, number][] = [];
  for (let i = 0; i < FACE_MESH_TRIANGLES.length; i += 3) tris.push([FACE_MESH_TRIANGLES[i]!, FACE_MESH_TRIANGLES[i + 1]!, FACE_MESH_TRIANGLES[i + 2]!]);
  const ovalPoly = FACE_OVAL.map((i) => pts[i]!);
  const outerIdx = [...FACE_OVAL, ...pts.map((_, i) => i).filter((i) => i >= LANDMARK_COUNT)];
  for (const [a, b, c] of delaunay(outerIdx.map((i) => pts[i]!))) {
    const [ia, ib, ic] = [outerIdx[a]!, outerIdx[b]!, outerIdx[c]!];
    const cx = (pts[ia]![0] + pts[ib]![0] + pts[ic]![0]) / 3;
    const cy = (pts[ia]![1] + pts[ib]![1] + pts[ic]![1]) / 3;
    if (!insidePolygon(cx, cy, ovalPoly)) tris.push([ia, ib, ic]);
  }
  // The face mesh also leaves the eye openings empty; fill them from the photo so the
  // eyes show, and so a blink folds the lids over them.
  const fillRing = (ringIdx: number[]) => {
    const ring = ringIdx.map((i) => pts[i]!);
    for (const [a, b, c] of delaunay(ring)) {
      const cx = (ring[a]![0] + ring[b]![0] + ring[c]![0]) / 3;
      const cy = (ring[a]![1] + ring[b]![1] + ring[c]![1]) / 3;
      if (insidePolygon(cx, cy, ring)) tris.push([ringIdx[a]!, ringIdx[b]!, ringIdx[c]!]);
    }
  };
  fillRing([33, ...EYES[0]!.upper, 133, ...[...EYES[0]!.lower].reverse()]);
  fillRing([263, ...EYES[1]!.upper, 362, ...[...EYES[1]!.lower].reverse()]);
  if (openPhoto) {
    const ring = INNER_RING.map((i) => pts[i]!);
    for (const [a, b, c] of delaunay(ring)) {
      const cx = (ring[a]![0] + ring[b]![0] + ring[c]![0]) / 3;
      const cy = (ring[a]![1] + ring[b]![1] + ring[c]![1]) / 3;
      if (insidePolygon(cx, cy, ring)) tris.push([INNER_RING[a]!, INNER_RING[b]!, INNER_RING[c]!]);
    }
  }
  const triangles = new Uint16Array(tris.flat());
  const rest = new Float32Array(pts.flat());
  const uv = new Float32Array(pts.flatMap(([x, y]) => [x / width, y / height]));

  const pivot: [number, number] = [chin[0], chin[1] + face.h * 0.25];
  const axisDepth = face.w * 0.55;
  const out = new Float32Array(n * 2);

  function deform(p: PhotoPose): Float32Array {
    const jawDrop = p.jaw * D * 0.2;
    const upperLift = p.jaw * D * 0.035;
    const wide = p.width * mouthHalfW * 0.5;
    const smileX = p.smile * D * 0.06;
    const smileY = -p.smile * D * 0.05;
    const brow = -p.browRaise * D * 0.08;
    const yaw = (p.yaw * Math.PI) / 180;
    const pitch = (p.pitch * Math.PI) / 180;
    const roll = (p.roll * Math.PI) / 180;
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const breathY = -p.breath * D * 0.03;

    for (let i = 0; i < n; i++) {
      let x = rest[i * 2]!;
      let y = rest[i * 2 + 1]!;
      // expression
      y += jawW[i]! * jawDrop - upperLipW[i]! * upperLift;
      if (LIP_POINTS.has(i) || i >= LANDMARK_COUNT || mouthWideW[i]! > 0.05) {
        const rel = clamp((x - mouthC[0]) / mouthHalfW, -1.4, 1.4);
        x += rel * wide * mouthWideW[i]!;
        x += Math.sign(x - mouthC[0]) * smileX * smileW[i]!;
        y += smileY * smileW[i]!;
      }
      y += brow * browW[i]!;
      out[i * 2] = x;
      out[i * 2 + 1] = y;
    }
    // eyelids and gaze
    EYES.forEach((_, k) => {
      const open = k === 0 ? p.eyeOpenL : p.eyeOpenR;
      const close = clamp(1 - open, -0.15, 0.95);
      for (const [u, l] of lid[k]!.pairs) {
        const dy = (rest[l * 2 + 1]! - rest[u * 2 + 1]!) * close;
        out[u * 2 + 1] = out[u * 2 + 1]! + dy;
      }
      const mid = lid[k]!.pairs[3]!;
      const creaseDy = (rest[mid[1] * 2 + 1]! - rest[mid[0] * 2 + 1]!) * close * 0.35;
      for (const c of lid[k]!.crease) out[c * 2 + 1] = out[c * 2 + 1]! + creaseDy;
      for (const ir of lid[k]!.iris) {
        out[ir * 2] = out[ir * 2]! + p.gazeX * D * 0.035;
        out[ir * 2 + 1] = out[ir * 2 + 1]! + p.gazeY * D * 0.02 + creaseDy * 0.5;
      }
    });
    // head pose (parallax from landmark depth), then body sway and breathing
    for (let i = 0; i < n; i++) {
      const w = headW[i]!;
      let x = out[i * 2]!;
      let y = out[i * 2 + 1]!;
      if (w > 0) {
        const depth = axisDepth - z[i]!;
        x += Math.sin(yaw) * depth * w * 0.5;
        y += Math.sin(pitch) * depth * w * 0.5;
        const rx = x - pivot[0];
        const ry = y - pivot[1];
        x = pivot[0] + (rx * cr - ry * sr - rx) * w + rx;
        y = pivot[1] + (rx * sr + ry * cr - ry) * w + ry;
      }
      const isBorder = rest[i * 2] === 0 || rest[i * 2] === width || rest[i * 2 + 1] === 0 || rest[i * 2 + 1] === height;
      if (!isBorder) {
        x += p.sway * (0.3 + 0.7 * w);
        if (rest[i * 2 + 1]! > forehead[1]) y += breathY * (y > chin[1] ? 1 : 0.6);
      }
      out[i * 2] = x;
      out[i * 2 + 1] = y;
    }
    return out;
  }

  function mouth(pos: Float32Array): { positions: number[]; colors: number[] } {
    const P = (i: number): [number, number] => [pos[i * 2]!, pos[i * 2 + 1]!];
    const positions: number[] = [];
    const colors: number[] = [];
    if (openPhoto) return { positions, colors };
    const tri = (a: [number, number], b: [number, number], c: [number, number], ca: number[], cb: number[], cc: number[]) => {
      positions.push(...a, ...b, ...c);
      colors.push(...ca, ...cb, ...cc);
    };
    const gap = UPPER_INNER.map((u, k) => P(LOWER_INNER[k]!)[1] - P(u)[1]);
    const maxGap = Math.max(...gap);
    if (maxGap < D * 0.012) return { positions, colors };
    // cavity: fan from the centre of the inner lip ring
    const ring = INNER_RING.map(P);
    const c: [number, number] = [ring.reduce((s, q) => s + q[0], 0) / ring.length, ring.reduce((s, q) => s + q[1], 0) / ring.length];
    const deep = [0.1, 0.02, 0.03, 1];
    const edge = [0.32, 0.11, 0.12, 1];
    for (let k = 0; k < ring.length; k++) tri(c, ring[k]!, ring[(k + 1) % ring.length]!, deep, edge, edge);
    // upper teeth hang from the upper inner lip, darkening toward the corners of the mouth
    const top = UPPER_INNER.map(P);
    const bottom = top.map((q, k) => [q[0], q[1] + Math.min(Math.max(0, P(LOWER_INNER[k]!)[1] - q[1]) * 0.42, D * 0.07)] as [number, number]);
    const shade = (j: number, lower: boolean) => {
      const f = Math.max(0, 1 - Math.abs(j / (top.length - 1) - 0.5) * 1.6) ** 0.6;
      const b = lower ? 0.82 : 0.9;
      return [0.3 + (b - 0.3) * f, 0.1 + (b - 0.04 - 0.1) * f, 0.1 + (b - 0.09 - 0.1) * f, 1];
    };
    for (let k = 0; k < top.length - 1; k++) {
      tri(top[k]!, top[k + 1]!, bottom[k]!, shade(k, false), shade(k + 1, false), shade(k, true));
      tri(top[k + 1]!, bottom[k + 1]!, bottom[k]!, shade(k + 1, false), shade(k + 1, true), shade(k, true));
    }
    return { positions, colors };
  }

  return { rest, uv, triangles, vertexCount: n, unit: D, faceBox: face, openPhoto, deform, mouth };
}
