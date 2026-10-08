import type { FaceLandmarker } from "@mediapipe/tasks-vision";

let landmarker: Promise<FaceLandmarker> | null = null;

/** MediaPipe Face Landmarker, loaded once from files bundled with the app (works offline). */
function load(): Promise<FaceLandmarker> {
  landmarker ??= (async () => {
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const base = new URL("mediapipe/", document.baseURI).href;
    const fileset = await FilesetResolver.forVisionTasks(`${base}wasm`);
    return FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}face_landmarker.task`, delegate: "CPU" },
      runningMode: "IMAGE",
      numFaces: 2,
    });
  })();
  return landmarker;
}

export interface DetectedFace {
  width: number;
  height: number;
  /** 478 points flattened [x, y, z, ...] */
  landmarks: number[];
}

/**
 * Finds the face in a portrait. Runs on this PC only; the photo is never sent anywhere.
 * Throws a Thai message the operator can act on when the photo will not animate well.
 */
export async function detectFace(src: string): Promise<DetectedFace> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const fl = await load();
  const res = fl.detect(img);
  const faces = res.faceLandmarks;
  if (!faces.length) throw new Error("ไม่พบใบหน้าในรูป ใช้รูปหน้าตรง เห็นหน้าชัด ไม่มีอะไรบัง");
  if (faces.length > 1) throw new Error("พบหลายใบหน้าในรูป ใช้รูปที่มีคนเดียว");
  const pts = faces[0]!;
  const xs = pts.map((p) => p.x);
  const faceW = (Math.max(...xs) - Math.min(...xs)) * img.naturalWidth;
  if (faceW < 120) throw new Error("ใบหน้าในรูปเล็กเกินไป ใช้รูปที่ความละเอียดสูงขึ้นหรือครอปให้หน้าใหญ่ขึ้น");
  // Turned heads warp badly; ask for a straight-on portrait.
  const l = pts[33]!;
  const r = pts[263]!;
  const nose = pts[1]!;
  const off = Math.abs((nose.x - (l.x + r.x) / 2) / (r.x - l.x));
  if (off > 0.18) throw new Error("หน้าหันข้างมากไป ใช้รูปหน้าตรงมองกล้อง");
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    landmarks: pts.flatMap((p) => [round(p.x), round(p.y), round(p.z)]),
  };
}

const round = (v: number) => Math.round(v * 1e5) / 1e5;
