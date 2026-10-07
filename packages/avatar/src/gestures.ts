import type { Gesture } from "@tlai/shared";

/** Pose of the upper body for a gesture at progress p (0..1). Angles in degrees. */
export interface ArmPose {
  leftShoulder: number;
  leftElbow: number;
  rightShoulder: number;
  rightElbow: number;
  /** extra head motion layered on top of idle */
  headPitch: number;
  headYaw: number;
  /** optional hand shape for the renderer */
  rightHand: "relaxed" | "open" | "point" | "thumb" | "count" | "heart";
  leftHand: "relaxed" | "open" | "heart";
}

export const REST_POSE: ArmPose = {
  leftShoulder: 8, leftElbow: 10, rightShoulder: -8, rightElbow: -10, headPitch: 0, headYaw: 0, rightHand: "relaxed", leftHand: "relaxed",
};

export const GESTURE_DURATION_MS: Record<Gesture, number> = {
  none: 0, wave: 1800, point_product: 1600, nod: 900, open_palms: 1500, count_fingers: 1700, thumbs_up: 1400, heart_hands: 1900, think_chin: 2200,
};

/** Bell-shaped envelope so every gesture rises, holds, and settles back. */
function envelope(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  if (p < 0.25) return easeOut(p / 0.25);
  if (p > 0.75) return easeOut((1 - p) / 0.25);
  return 1;
}
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

export function gesturePose(g: Gesture, p: number, energy = 1): ArmPose {
  const e = envelope(p) * Math.min(1.3, Math.max(0.6, energy));
  const pose: ArmPose = { ...REST_POSE };
  switch (g) {
    case "wave":
      pose.rightShoulder = -8 - 120 * e;
      pose.rightElbow = -10 - 40 * e + Math.sin(p * Math.PI * 8) * 22 * e;
      pose.rightHand = "open";
      pose.headPitch = -2 * e;
      break;
    case "point_product":
      pose.rightShoulder = -8 - 65 * e;
      pose.rightElbow = -10 + 15 * e;
      pose.rightHand = "point";
      pose.headYaw = 10 * e;
      break;
    case "nod":
      pose.headPitch = Math.sin(p * Math.PI * 2) * 7;
      break;
    case "open_palms":
      pose.leftShoulder = 8 + 35 * e;
      pose.leftElbow = 10 + 50 * e;
      pose.rightShoulder = -8 - 35 * e;
      pose.rightElbow = -10 - 50 * e;
      pose.leftHand = "open";
      pose.rightHand = "open";
      break;
    case "count_fingers":
      pose.rightShoulder = -8 - 70 * e;
      pose.rightElbow = -10 - 70 * e;
      pose.rightHand = "count";
      break;
    case "thumbs_up":
      pose.rightShoulder = -8 - 55 * e;
      pose.rightElbow = -10 - 85 * e;
      pose.rightHand = "thumb";
      pose.headPitch = -3 * e;
      break;
    case "heart_hands":
      pose.leftShoulder = 8 + 70 * e;
      pose.leftElbow = 10 + 85 * e;
      pose.rightShoulder = -8 - 70 * e;
      pose.rightElbow = -10 - 85 * e;
      pose.leftHand = "heart";
      pose.rightHand = "heart";
      break;
    case "think_chin":
      pose.rightShoulder = -8 - 45 * e;
      pose.rightElbow = -10 - 120 * e;
      pose.rightHand = "relaxed";
      pose.headYaw = -6 * e;
      pose.headPitch = 3 * e;
      break;
    case "none":
      break;
  }
  return pose;
}
