/**
 * Bowyer–Watson Delaunay triangulation. Small and dependency-free; the photo rig
 * triangulates ~600 points once per character, so O(n²) is fine.
 * Returns triangles as index triples into `pts`.
 */
export function delaunay(pts: ReadonlyArray<readonly [number, number]>): [number, number, number][] {
  const n = pts.length;
  if (n < 3) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const d = Math.max(maxX - minX, maxY - minY) * 20;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Super-triangle vertices live at indices n, n+1, n+2.
  const P: [number, number][] = [...pts.map((p) => [p[0], p[1]] as [number, number]), [cx - d, cy - d], [cx, cy + d], [cx + d, cy - d]];

  interface Tri { a: number; b: number; c: number; x: number; y: number; r2: number }
  const circum = (a: number, b: number, c: number): Tri => {
    const [ax, ay] = P[a]!;
    const [bx, by] = P[b]!;
    const [cx2, cy2] = P[c]!;
    const D = 2 * (ax * (by - cy2) + bx * (cy2 - ay) + cx2 * (ay - by));
    if (Math.abs(D) < 1e-12) return { a, b, c, x: 0, y: 0, r2: Infinity };
    const a2 = ax * ax + ay * ay;
    const b2 = bx * bx + by * by;
    const c2 = cx2 * cx2 + cy2 * cy2;
    const x = (a2 * (by - cy2) + b2 * (cy2 - ay) + c2 * (ay - by)) / D;
    const y = (a2 * (cx2 - bx) + b2 * (ax - cx2) + c2 * (bx - ax)) / D;
    return { a, b, c, x, y, r2: (ax - x) ** 2 + (ay - y) ** 2 };
  };

  let tris: Tri[] = [circum(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const [px, py] = P[i]!;
    const bad: Tri[] = [];
    const keep: Tri[] = [];
    for (const t of tris) ((px - t.x) ** 2 + (py - t.y) ** 2 < t.r2 ? bad : keep).push(t);
    // Boundary of the cavity = edges that belong to exactly one bad triangle.
    const edges = new Map<string, [number, number]>();
    for (const t of bad) {
      for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as const) {
        const k = u < v ? `${u},${v}` : `${v},${u}`;
        if (edges.has(k)) edges.delete(k);
        else edges.set(k, [u, v]);
      }
    }
    for (const [u, v] of edges.values()) keep.push(circum(u, v, i));
    tris = keep;
  }
  return tris.filter((t) => t.a < n && t.b < n && t.c < n).map((t) => [t.a, t.b, t.c]);
}
