import { describe, expect, it } from "vitest";
import face from "./__fixtures__/face.json";
import { buildPhotoRig, NEUTRAL_PHOTO_POSE } from "./photoRig.js";

// Landmarks detected by MediaPipe on a public-domain NASA portrait (scikit-image "astronaut"), 1080×1728.
const rig = buildPhotoRig(face.landmarks, face.width, face.height);
const y = (pos: Float32Array, i: number) => pos[i * 2 + 1]!;

describe("photo rig", () => {
  it("builds a valid mesh with a hole for the mouth", () => {
    expect(rig.vertexCount).toBeGreaterThan(478);
    expect(rig.triangles.length % 3).toBe(0);
    expect(Math.max(...rig.triangles)).toBeLessThan(rig.vertexCount);
    expect(rig.unit).toBeGreaterThan(50);
  });

  it("covers the eyes (the face mesh leaves them open) so they never show through", () => {
    const used = new Set(rig.triangles);
    for (const i of [159, 145, 386, 374, 33, 133, 263, 362]) expect(used.has(i)).toBe(true);
    // a triangle joins the upper and lower lid of each eye
    const tris = Array.from({ length: rig.triangles.length / 3 }, (_, k) => [...rig.triangles.slice(k * 3, k * 3 + 3)]);
    expect(tris.some((t) => t.includes(159) && (t.includes(145) || t.includes(144) || t.includes(153)))).toBe(true);
  });

  it("leaves the photo untouched at rest", () => {
    const pos = rig.deform(NEUTRAL_PHOTO_POSE);
    let max = 0;
    for (let i = 0; i < pos.length; i++) max = Math.max(max, Math.abs(pos[i]! - rig.rest[i]!));
    expect(max).toBeLessThan(0.01);
  });

  it("opens the jaw, shows the mouth inside, and closes the eyelids", () => {
    const open = rig.deform({ ...NEUTRAL_PHOTO_POSE, jaw: 1 });
    expect(y(open, 14) - y(open, 13)).toBeGreaterThan(y(rig.rest, 14) - y(rig.rest, 13) + rig.unit * 0.15);
    // This test photo smiles with teeth showing, so its own mouth is kept instead of a drawn interior.
    expect(rig.openPhoto).toBe(true);
    expect(rig.mouth(open).positions.length).toBe(0);
    const shut = rig.deform({ ...NEUTRAL_PHOTO_POSE, eyeOpenL: 0, eyeOpenR: 0 });
    expect(Math.abs(y(shut, 159) - y(shut, 145))).toBeLessThan(Math.abs(y(rig.rest, 159) - y(rig.rest, 145)) * 0.2);
  });

  it("draws a mouth interior for a closed-mouth photo", () => {
    // Close the fixture's lips by moving the lower inner lip onto the upper one.
    const lm = [...face.landmarks];
    for (const [u, l] of [[13, 14], [82, 87], [312, 317], [81, 178], [311, 402], [80, 88], [310, 318], [191, 95], [415, 324]] as const) lm[l * 3 + 1] = lm[u * 3 + 1]! + 0.001;
    const closed = buildPhotoRig(lm, face.width, face.height);
    expect(closed.openPhoto).toBe(false);
    expect(closed.mouth(closed.deform(NEUTRAL_PHOTO_POSE)).positions.length).toBe(0);
    expect(closed.mouth(closed.deform({ ...NEUTRAL_PHOTO_POSE, jaw: 0.8 })).positions.length).toBeGreaterThan(0);
  });

  it("turns the head without moving the photo's edges", () => {
    const turned = rig.deform({ ...NEUTRAL_PHOTO_POSE, yaw: 6, roll: 4 });
    expect(Math.abs(turned[1 * 2]! - rig.rest[1 * 2]!)).toBeGreaterThan(2);
    const last = rig.vertexCount - 1; // bottom-right corner of the grid
    expect(turned[last * 2]).toBeCloseTo(rig.rest[last * 2]!, 3);
  });
});
