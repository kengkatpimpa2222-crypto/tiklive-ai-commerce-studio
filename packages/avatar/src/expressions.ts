import type { Emotion } from "@tlai/shared";

/** Facial targets for each emotion. The controller eases toward these. */
export interface FaceTargets {
  smile: number; // -1 frown .. 1 big smile
  browRaise: number; // -1 furrowed .. 1 raised
  eyeOpen: number; // 0..1.2 baseline lid opening
  cheek: number; // 0..1 cheek lift
  headTilt: number; // degrees roll bias
  energy: number; // scales idle motion and gesture amplitude
}

export const EXPRESSIONS: Record<Emotion, FaceTargets> = {
  neutral: { smile: 0.25, browRaise: 0, eyeOpen: 1, cheek: 0.1, headTilt: 0, energy: 1 },
  happy: { smile: 0.75, browRaise: 0.2, eyeOpen: 0.9, cheek: 0.6, headTilt: 3, energy: 1.2 },
  excited: { smile: 1, browRaise: 0.55, eyeOpen: 1.1, cheek: 0.8, headTilt: 4, energy: 1.6 },
  thinking: { smile: 0, browRaise: -0.25, eyeOpen: 0.85, cheek: 0, headTilt: -6, energy: 0.6 },
  surprised: { smile: 0.2, browRaise: 1, eyeOpen: 1.2, cheek: 0.1, headTilt: 0, energy: 1.3 },
  calm: { smile: 0.35, browRaise: 0, eyeOpen: 0.88, cheek: 0.2, headTilt: 2, energy: 0.7 },
  apologetic: { smile: -0.1, browRaise: 0.45, eyeOpen: 0.85, cheek: 0, headTilt: -4, energy: 0.6 },
};
