import { assertCapabilities, UNSUPPORTED_TIKTOK_MESSAGE, type AllowedCapability } from "@tlai/compliance";

export { UNSUPPORTED_TIKTOK_MESSAGE };

export interface TikTokCapabilities {
  accountInfo: boolean;
  liveStatus: boolean;
  /** Receive viewer comments through an approved API. */
  viewerComments: boolean;
  pinProduct: boolean;
}

export type ProviderResult<T> = { ok: true; data: T } | { ok: false; message: string; openUrl?: string };

export interface TikTokProvider {
  readonly id: string;
  readonly capabilities: TikTokCapabilities;
  readonly usesCapabilities: readonly AllowedCapability[];
  getAccountInfo(): Promise<ProviderResult<{ displayName: string; username: string }>>;
  getLiveStatus(): Promise<ProviderResult<{ live: boolean }>>;
  pinProduct(productSku: string): Promise<ProviderResult<void>>;
}

const unsupported = <T>(openUrl?: string): ProviderResult<T> => ({ ok: false, message: UNSUPPORTED_TIKTOK_MESSAGE, openUrl });

/**
 * Default provider. The stream goes out through TikTok LIVE Studio (or OBS with an
 * official stream key), viewer questions are typed in by the operator, and
 * product pinning is done by the seller in TikTok's own tools.
 */
export class ManualTikTokProvider implements TikTokProvider {
  readonly id = "manual";
  readonly capabilities: TikTokCapabilities = { accountInfo: false, liveStatus: false, viewerComments: false, pinProduct: false };
  readonly usesCapabilities = ["manual_viewer_input", "open_official_tiktok_tool"] as const;
  constructor() {
    assertCapabilities(this.id, this.usesCapabilities);
  }
  async getAccountInfo() {
    return unsupported<{ displayName: string; username: string }>();
  }
  async getLiveStatus() {
    return unsupported<{ live: boolean }>();
  }
  async pinProduct() {
    return unsupported<void>("https://seller-th.tiktok.com/");
  }
}

/**
 * Placeholder for TikTok's official developer APIs. Each method stays
 * unsupported until the app has been approved for the matching scope; it never
 * falls back to private endpoints or page automation.
 */
export class OfficialTikTokProvider implements TikTokProvider {
  readonly id = "official";
  readonly usesCapabilities = ["official_tiktok_api"] as const;
  readonly capabilities: TikTokCapabilities;
  constructor(private readonly opts: { clientKey: string; approvedScopes: string[] }) {
    assertCapabilities(this.id, this.usesCapabilities);
    const s = new Set(opts.approvedScopes);
    this.capabilities = { accountInfo: s.has("user.info.basic"), liveStatus: false, viewerComments: false, pinProduct: false };
  }
  async getAccountInfo() {
    if (!this.capabilities.accountInfo) return unsupported<{ displayName: string; username: string }>();
    // Requires the OAuth access token from TikTok Login Kit; wired up once credentials are issued.
    return unsupported<{ displayName: string; username: string }>();
  }
  async getLiveStatus() {
    return unsupported<{ live: boolean }>();
  }
  async pinProduct() {
    return unsupported<void>("https://seller-th.tiktok.com/");
  }
}
