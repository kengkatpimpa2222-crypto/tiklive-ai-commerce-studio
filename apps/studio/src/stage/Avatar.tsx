import type { AvatarFrame } from "@tlai/avatar";
import type { HostCharacter } from "@tlai/shared";
import type { Viseme } from "@tlai/tts";
import { useId } from "react";

/** Mouth width/height factors per viseme shape. */
const MOUTH: Record<Viseme, { w: number; h: number; round: number }> = {
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

function Arm({ side, shoulder, elbow, hand, skin, sleeve }: { side: 1 | -1; shoulder: number; elbow: number; hand: string; skin: string; sleeve: string }) {
  const x = side * 150;
  return (
    <g transform={`translate(${x} -40) rotate(${shoulder})`}>
      <rect x={-28} y={0} width={56} height={170} rx={28} fill={sleeve} />
      <g transform={`translate(0 160) rotate(${elbow})`}>
        <rect x={-23} y={0} width={46} height={150} rx={23} fill={skin} />
        <g transform="translate(0 160)">
          {hand === "point" ? (
            <>
              <ellipse rx={30} ry={26} fill={skin} />
              <rect x={-7} y={6} width={14} height={50} rx={7} fill={skin} />
            </>
          ) : hand === "thumb" ? (
            <>
              <ellipse rx={30} ry={28} fill={skin} />
              <rect x={side * 14 - 7} y={-62} width={14} height={44} rx={7} fill={skin} />
            </>
          ) : hand === "count" ? (
            <>
              <ellipse rx={30} ry={26} fill={skin} />
              {[-14, 0, 14].map((dx) => (
                <rect key={dx} x={dx - 6} y={-66} width={12} height={46} rx={6} fill={skin} />
              ))}
            </>
          ) : hand === "heart" ? (
            <path d="M0 18 C -30 -6, -24 -36, 0 -18 C 24 -36, 30 -6, 0 18 Z" fill="#ff4f7b" stroke={skin} strokeWidth={10} />
          ) : (
            <ellipse rx={hand === "open" ? 34 : 28} ry={hand === "open" ? 36 : 30} fill={skin} />
          )}
        </g>
      </g>
    </g>
  );
}

/** Darkens (k < 0) or lightens (k > 0) a #rrggbb colour. */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Back hair (behind the head and shoulders) per cut. */
const BACK_HAIR: Record<string, string> = {
  long: "M-210 -40 C -230 -260, 230 -260, 210 -40 L 230 250 C 120 300, -120 300, -230 250 Z",
  bob: "M-212 -40 C -232 -262, 232 -262, 212 -40 L 222 120 C 150 150, -150 150, -222 120 Z",
  ponytail: "M-190 -40 C -212 -262, 212 -262, 190 -40 Z M 120 -190 C 260 -230, 300 -40, 250 160 C 230 220, 200 240, 190 200 C 230 60, 200 -80, 120 -150 Z",
  short: "M-184 -30 C -196 -268, 196 -268, 184 -30 Z",
  side: "M-186 -30 C -198 -270, 198 -270, 186 -30 Z",
};

/** Bangs / front hair per cut. */
const FRONT_HAIR: Record<string, string> = {
  long: "M-182 -60 C -170 -230, 170 -250, 186 -50 C 120 -150, 40 -120, -10 -170 C -60 -110, -130 -130, -182 -60 Z",
  bob: "M-186 -40 C -180 -240, 180 -250, 188 -40 C 150 -120, 120 -110, 80 -112 C 20 -118, -40 -110, -100 -114 C -140 -112, -170 -100, -186 -40 Z",
  ponytail: "M-178 -70 C -168 -238, 168 -248, 180 -70 C 140 -170, 60 -190, 10 -186 C -50 -184, -130 -170, -178 -70 Z",
  short: "M-180 -50 C -186 -262, 186 -270, 182 -50 C 168 -110, 130 -136, 70 -130 C 30 -142, -30 -142, -70 -130 C -130 -136, -168 -110, -180 -50 Z",
  side: "M-184 -40 C -190 -270, 190 -276, 186 -60 C 172 -128, 128 -150, 50 -146 C -30 -140, -100 -112, -146 -70 C -162 -56, -174 -46, -184 -40 Z",
};

/** Stylized 2D virtual host. Every moving part is driven by an AvatarFrame. */
export function Avatar({ frame: f, character }: { frame: AvatarFrame; character: HostCharacter }) {
  const L = character.look;
  const cut = L.hairStyle && BACK_HAIR[L.hairStyle] ? L.hairStyle : "long";
  const masc = cut === "short" || cut === "side";
  // Several hosts can be on one page (the gallery), so gradient ids must be unique.
  const uid = useId().replace(/:/g, "");
  const id = (n: string) => `${n}-${uid}`;
  const yawX = f.headYaw * 2.2; // facial features shift with yaw
  const pitchY = f.headPitch * 1.6;
  const m = MOUTH[f.viseme];
  const open = Math.max(0.04, f.mouthOpen);
  const mw = 34 * m.w * (1 + f.face.smile * 0.15);
  const mh = 34 * Math.max(m.h * open, 0.03) + 2;
  const smileCurve = f.face.smile * 14;
  const browY = -78 - f.face.browRaise * 14;
  const eyeRy = 22 * Math.min(1.2, f.eyeOpenL);
  const gx = f.gazeX * 7;
  const gy = f.gazeY * 5;
  const breathScale = 1 + f.breath * 0.012;

  return (
    <svg viewBox="-540 -960 1080 1920" className="avatar-svg" aria-label={`${character.name} AI virtual host`}>
      <defs>
        <radialGradient id={id("av-face")} cx="45%" cy="38%" r="70%">
          <stop offset="0%" stopColor={shade(L.skin, 0.12)} />
          <stop offset="70%" stopColor={L.skin} />
          <stop offset="100%" stopColor={shade(L.skin, -0.12)} />
        </radialGradient>
        <linearGradient id={id("av-hair")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={shade(L.hair, 0.22)} />
          <stop offset="55%" stopColor={L.hair} />
          <stop offset="100%" stopColor={shade(L.hair, -0.3)} />
        </linearGradient>
        <radialGradient id={id("av-iris")} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor={shade(L.eyes, 0.35)} />
          <stop offset="100%" stopColor={shade(L.eyes, -0.35)} />
        </radialGradient>
        <linearGradient id={id("av-outfit")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={shade(L.outfit, 0.1)} />
          <stop offset="100%" stopColor={shade(L.outfit, -0.22)} />
        </linearGradient>
        <filter id={id("av-soft")} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="12" stdDeviation="18" floodColor="#000" floodOpacity="0.18" />
        </filter>
      </defs>
      <g transform={`translate(${f.bodySway} ${260}) scale(${breathScale})`}>
        {/* back hair */}
        <g transform={`translate(${yawX * 0.3} ${-330 + pitchY * 0.3}) rotate(${f.headRoll})`}>
          <path d={BACK_HAIR[cut]} fill={`url(#${id("av-hair")})`} />
        </g>
        {/* torso */}
        <path d="M-190 -60 C -200 120, -230 420, -260 700 L 260 700 C 230 420, 200 120, 190 -60 C 120 -110, -120 -110, -190 -60 Z" fill={`url(#${id("av-outfit")})`} filter={`url(#${id("av-soft")})`} />
        <path d="M-150 -70 C -90 -40, 90 -40, 150 -70" fill="none" stroke={shade(L.outfit, -0.25)} strokeWidth={6} opacity={0.5} />
        <path d="M-60 -95 L 0 0 L 60 -95" fill="none" stroke={L.accent} strokeWidth={14} strokeLinejoin="round" />
        <rect x={-48} y={-150} width={96} height={80} rx={30} fill={L.skin} />
        <ellipse cx={0} cy={-128} rx={52} ry={18} fill={shade(L.skin, -0.2)} opacity={0.55} />
        {/* AI badge on outfit: part of the disclosure */}
        <g transform="translate(110 40)">
          <rect x={-52} y={-26} width={104} height={52} rx={14} fill="#111a" />
          <text x={0} y={11} textAnchor="middle" fontSize={32} fontWeight={800} fill="#fff">
            AI
          </text>
        </g>
        <Arm side={-1} shoulder={f.arms.leftShoulder} elbow={f.arms.leftElbow} hand={f.arms.leftHand} skin={L.skin} sleeve={L.outfit} />
        <Arm side={1} shoulder={f.arms.rightShoulder} elbow={f.arms.rightElbow} hand={f.arms.rightHand} skin={L.skin} sleeve={L.outfit} />

        {/* head */}
        <g transform={`translate(${yawX * 0.5} ${-330 + pitchY * 0.5}) rotate(${f.headRoll})`}>
          <ellipse cx={0} cy={0} rx={175 - Math.abs(f.headYaw) * 1.2} ry={205} fill={`url(#${id("av-face")})`} />
          <ellipse cx={-178 + yawX * 0.2} cy={10} rx={22} ry={40} fill={L.skin} />
          <ellipse cx={178 + yawX * 0.2} cy={10} rx={22} ry={40} fill={L.skin} />
          {!masc && (
            <>
              <circle cx={-180 + yawX * 0.2} cy={58} r={9} fill={L.accent} />
              <circle cx={180 + yawX * 0.2} cy={58} r={9} fill={L.accent} />
            </>
          )}
          <g transform={`translate(${yawX} ${pitchY})`}>
            {/* cheeks */}
            <ellipse cx={-92} cy={62} rx={34} ry={20} fill="#ff6b8a" opacity={0.12 + f.face.cheek * 0.3} />
            <ellipse cx={92} cy={62} rx={34} ry={20} fill="#ff6b8a" opacity={0.12 + f.face.cheek * 0.3} />
            {/* eyes */}
            {[-68, 68].map((ex) => (
              <g key={ex} transform={`translate(${ex} -10)`}>
                <ellipse rx={30} ry={Math.max(1.5, eyeRy)} fill="#fff" />
                {eyeRy > 4 && (
                  <>
                    <circle cx={gx} cy={gy} r={Math.min(17, eyeRy)} fill={`url(#${id("av-iris")})`} />
                    <circle cx={gx} cy={gy} r={Math.min(7, eyeRy * 0.4)} fill="#120c0a" />
                    <circle cx={gx + 5} cy={gy - 6} r={5} fill="#fff" />
                    <circle cx={gx - 5} cy={gy + 5} r={2.2} fill="#fff" opacity={0.8} />
                  </>
                )}
                <path d={`M -34 ${-eyeRy + 2} Q 0 ${-eyeRy - 12} 34 ${-eyeRy + 2}`} stroke="#1b1311" strokeWidth={6} fill="none" strokeLinecap="round" />
                {/* outer-corner lashes */}
                {!masc && <path
                  d={ex < 0 ? `M -32 ${-eyeRy + 2} l -12 -8 M -26 ${-eyeRy - 3} l -9 -11` : `M 32 ${-eyeRy + 2} l 12 -8 M 26 ${-eyeRy - 3} l 9 -11`}
                  stroke="#1b1311"
                  strokeWidth={4}
                  strokeLinecap="round"
                />}
                {eyeRy > 6 && <path d={`M -24 ${eyeRy - 1} Q 0 ${eyeRy + 5} 24 ${eyeRy - 1}`} stroke={shade(L.skin, -0.3)} strokeWidth={2.5} fill="none" opacity={0.7} />}
              </g>
            ))}
            {/* brows */}
            <path d={`M -100 ${browY + 4 + f.face.browRaise * 4} Q -68 ${browY - 8} -36 ${browY + 2}`} stroke={L.hair} strokeWidth={10} fill="none" strokeLinecap="round" />
            <path d={`M 36 ${browY + 2} Q 68 ${browY - 8} 100 ${browY + 4 + f.face.browRaise * 4}`} stroke={L.hair} strokeWidth={10} fill="none" strokeLinecap="round" />
            {/* nose */}
            <path d="M 0 20 Q -8 46 6 50" stroke="#c98f72" strokeWidth={5} fill="none" strokeLinecap="round" />
            {/* mouth */}
            <g transform="translate(0 100)">
              {mh > 6 ? (
                <>
                  <path
                    d={`M ${-mw} ${-smileCurve * 0.3} Q 0 ${-mh * 0.35 - smileCurve * 0.2} ${mw} ${-smileCurve * 0.3} Q ${mw * (0.8 - m.round * 0.2)} ${mh} 0 ${mh + smileCurve * 0.2} Q ${-mw * (0.8 - m.round * 0.2)} ${mh} ${-mw} ${-smileCurve * 0.3} Z`}
                    fill="#7a2335"
                  />
                  <ellipse cx={0} cy={mh * 0.7} rx={mw * 0.5} ry={mh * 0.25} fill="#e86a7c" />
                  {m.h > 0.35 && <rect x={-mw * 0.6} y={-mh * 0.2} width={mw * 1.2} height={Math.min(10, mh * 0.25)} rx={4} fill="#fff" />}
                </>
              ) : (
                <path d={`M ${-mw} 0 Q 0 ${smileCurve + 4} ${mw} 0`} stroke="#9b3446" strokeWidth={7} fill="none" strokeLinecap="round" />
              )}
            </g>
          </g>
          {/* front hair / bangs */}
          <path d={FRONT_HAIR[cut]} fill={`url(#${id("av-hair")})`} />
          <path d="M-120 -170 C -80 -205, -20 -215, 30 -205" stroke={shade(L.hair, 0.45)} strokeWidth={10} fill="none" strokeLinecap="round" opacity={0.55} />
          {!masc && (
            <>
              <circle cx={150} cy={-150} r={20} fill={L.accent} />
              <circle cx={144} cy={-156} r={6} fill="#fff" opacity={0.6} />
            </>
          )}
        </g>
      </g>
    </svg>
  );
}
