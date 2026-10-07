/**
 * Capabilities this product will never implement. Every integration registers
 * the capabilities it uses; registering one of these throws at startup.
 */
export const PROHIBITED_CAPABILITIES = [
  "view_botting",
  "like_botting",
  "comment_botting",
  "follower_botting",
  "spam_messaging",
  "fake_engagement",
  "captcha_bypass",
  "ban_evasion",
  "enforcement_bypass",
  "device_fingerprint_spoofing",
  "account_farming",
  "cookie_extraction",
  "credential_collection",
  "tiktok_scraping",
  "private_api_reverse_engineering",
  "evasive_browser_automation",
  "fake_human_behavior",
] as const;
export type ProhibitedCapability = (typeof PROHIBITED_CAPABILITIES)[number];

export const ALLOWED_CAPABILITIES = [
  "local_avatar_render",
  "local_tts",
  "remote_tts",
  "llm_text_generation",
  "obs_browser_source",
  "manual_viewer_input",
  "official_tiktok_api",
  "open_official_tiktok_tool",
] as const;
export type AllowedCapability = (typeof ALLOWED_CAPABILITIES)[number];

export class ProhibitedCapabilityError extends Error {
  constructor(cap: string, owner: string) {
    super(`${owner} requested prohibited capability "${cap}". This product does not implement it.`);
    this.name = "ProhibitedCapabilityError";
  }
}

export function assertCapabilities(owner: string, caps: readonly string[]): void {
  for (const c of caps) {
    if ((PROHIBITED_CAPABILITIES as readonly string[]).includes(c)) throw new ProhibitedCapabilityError(c, owner);
    if (!(ALLOWED_CAPABILITIES as readonly string[]).includes(c)) {
      throw new Error(`${owner} requested unknown capability "${c}". Add it to ALLOWED_CAPABILITIES after review.`);
    }
  }
}

export const UNSUPPORTED_TIKTOK_MESSAGE = "ฟังก์ชันนี้ต้องดำเนินการผ่าน TikTok LIVE Studio หรือเครื่องมือที่ TikTok รองรับ";
