import { AvatarController, type AvatarFrame } from "@tlai/avatar";
import { formatBaht, type HostCharacter, type Product, type Promotion, type Scene, type StageCommand, type StudioSettings, type ViewerQuestion } from "@tlai/shared";
import { useEffect, useRef, useState } from "react";
import { connect } from "../lib/api";
import { Avatar } from "./Avatar";
import { PhotoAvatar } from "./PhotoAvatar";
import { SpeechEngine } from "./speech";

const DEFAULT_CHARACTER: HostCharacter = {
  id: "default", name: "AI Host", disclosureLabel: "AI Virtual Host · ผู้ดำเนินรายการเป็นตัวละคร AI", persona: "", politeParticle: "ค่ะ",
  voice: { provider: "browser", voice: "", lang: "th-TH", rate: 1, pitch: 1 },
  look: { skin: "#f3cfb3", hair: "#2a1b17", eyes: "#3a2418", outfit: "#ff4f7b", accent: "#ffd166" },
};

/**
 * The on-air picture (1080×1920). Load it in OBS as a Browser Source
 * (http://127.0.0.1:4417/#/stage, "Control audio via OBS" on) or open it from the
 * desktop app, then send OBS to TikTok LIVE Studio / an official stream key.
 */
export function StagePage() {
  const preview = location.hash.includes("preview");
  const [character, setCharacter] = useState<HostCharacter>(DEFAULT_CHARACTER);
  const [scene, setScene] = useState<Scene | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [caption, setCaption] = useState("");
  const [question, setQuestion] = useState<ViewerQuestion | null>(null);
  const [frame, setFrame] = useState<AvatarFrame | null>(null);
  const [needsClick, setNeedsClick] = useState(false);
  const [settings, setSettings] = useState<StudioSettings["stage"] | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ctl = useRef(new AvatarController(Math.floor(Math.random() * 1e6)));
  const speech = useRef(new SpeechEngine(preview));
  const charRef = useRef(character);
  charRef.current = character;

  // The stage is captured as a window: never show scrollbars.
  useEffect(() => {
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }, []);

  // Animation loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      setFrame(ctl.current.update(Math.min(64, t - last)));
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Commands from the director
  useEffect(() => {
    window.speechSynthesis?.getVoices();
    let captionTimer = 0;
    const link = connect(preview ? "preview" : "stage", (cmd: StageCommand) => {
      const c = ctl.current;
      switch (cmd.type) {
        case "character":
          setCharacter(cmd.character);
          break;
        case "scene":
          setScene(cmd.scene);
          break;
        case "settings":
          setSettings(cmd.settings.stage);
          break;
        case "product":
          setProduct(cmd.product);
          setPromos(cmd.promotions);
          break;
        case "question":
          setQuestion(cmd.question);
          break;
        case "emotion":
          c.setEmotion(cmd.emotion, 4000);
          break;
        case "gesture":
          c.playGesture(cmd.gesture);
          break;
        case "stop_speaking":
          speech.current.stop();
          c.stopSpeech();
          break;
        case "speak": {
          const seg = cmd.segment;
          clearTimeout(captionTimer);
          setCaption(seg.text);
          c.setEmotion(seg.emotion);
          if (seg.source !== "qa") setQuestion(null);
          speech.current
            .speak(seg, charRef.current, {
              onStart: (v, d) => {
                c.startSpeech(v, d);
                if (seg.gesture !== "none") setTimeout(() => c.playGesture(seg.gesture), 180);
              },
              onAmplitude: (a) => c.setAmplitude(a),
              onDuration: (d) => c.setSpeechDuration(d),
              onEnd: () => {
                c.stopSpeech();
                if (!preview) link.send({ type: "speech_done", segmentId: seg.id });
                captionTimer = window.setTimeout(() => setCaption(""), 2500);
              },
            })
            .catch(() => setNeedsClick(true));
          break;
        }
      }
    });
    return () => link.close();
  }, []);

  // Prefer a product-specific promotion over shop-wide ones while a product is on screen.
  const promo = promos.find((p) => product && p.productIds.includes(product.id)) ?? promos[0];
  const endsIn = promo?.endsAt ? Date.parse(promo.endsAt) - now : NaN;
  const showCaptions = (scene?.showCaptions ?? true) && (settings?.showCaptions ?? true);
  const avatarStyle = settings
    ? { transform: `translate(${settings.avatarX * 100}%, ${settings.avatarY * 100}%) scale(${settings.avatarScale})` }
    : undefined;
  return (
    <div className="stage" style={{ background: scene?.background ?? "linear-gradient(160deg,#ffe3ec,#fff1c9)" }} onClick={() => setNeedsClick(false)}>
      <div className="stage-canvas">
        {settings?.backgroundImage && (
          <div className="stage-bg" style={{ backgroundImage: `url(${settings.backgroundImage})` }}>
            <div style={{ background: `rgba(0,0,0,${settings.backgroundDim})` }} />
          </div>
        )}
        <div className="avatar-wrap" style={avatarStyle}>
          {frame && (character.look.style === "photo" && character.look.photo ? <PhotoAvatar frame={frame} photo={character.look.photo} /> : <Avatar frame={frame} character={character} />)}
        </div>
        {settings?.shopName && <div className="shop-name">{settings.shopName}</div>}

        {/* Disclosure is always on screen and cannot be hidden from the UI. */}
        <div className="disclosure">
          <span className="dot" /> {character.disclosureLabel || DEFAULT_CHARACTER.disclosureLabel}
        </div>
        <div className="host-name">{character.name}</div>
        <SpeakingBadge frame={frame} />

        {(scene?.showPromoBanner ?? true) && promo && (
          <div className="promo-banner">
            <b>{promo.title}</b> {promo.detail}
            {endsIn > 0 && endsIn < 48 * 3600_000 && <span className="countdown">หมดเขตใน {fmtLeft(endsIn)}</span>}
          </div>
        )}

        {question && (
          <div className="question-bubble">
            <small>{question.author ? `${question.author} ถามว่า` : "คำถามจากผู้ชม"}</small>
            {question.text}
          </div>
        )}

        {(scene?.showProductCard ?? true) && product && (
          <div className="product-card">
            {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <div className="ph">{product.name.slice(0, 2)}</div>}
            <div className="pc-body">
              <div className="pc-name">{product.name}</div>
              <div className="pc-price">
                {formatBaht(product.price)}
                {product.compareAtPrice && <s>{formatBaht(product.compareAtPrice)}</s>}
              </div>
              {product.stock === 0 && <div className="pc-oos">สินค้าหมดชั่วคราว</div>}
              <div className="pc-cta">กดตะกร้าสินค้าเพื่อสั่งซื้อ</div>
            </div>
          </div>
        )}

        {showCaptions && caption && <div className="caption">{caption}</div>}
        {needsClick && <div className="click-hint">คลิกหนึ่งครั้งเพื่อเปิดเสียง</div>}
      </div>
    </div>
  );
}

function fmtLeft(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h > 0 ? `${h}:` : ""}${pad(m)}:${pad(s % 60)}`;
}

/** "AI กำลังพูดขาย" with a voice meter that follows the mouth, shown while the host talks. */
function SpeakingBadge({ frame }: { frame: AvatarFrame | null }) {
  const t = performance.now() / 1000;
  const lastSpoke = useRef(-Infinity);
  if (frame?.speaking) lastSpoke.current = t;
  // Stay up through the short pauses between sentences instead of flickering.
  const on = t - lastSpoke.current < 1.5;
  const level = frame?.speaking ? 0.45 + 0.55 * Math.min(1, (frame.mouthOpen ?? 0) * 1.4) : 0.15;
  return (
    <div className={`speaking-badge${on ? " on" : ""}`} aria-hidden={!on}>
      <span className="mic">
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">
          <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
        </svg>
      </span>
      AI กำลังพูดขาย
      <span className="bars">
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} style={{ height: `${35 + 65 * level * Math.abs(Math.sin(t * 7 + i * 1.3))}%` }} />
        ))}
      </span>
    </div>
  );
}
