import { api } from "../lib/api";

type Status = "connecting" | "ready" | "error" | "closed";

/**
 * WebRTC link to a realistic D-ID avatar. Signalling goes through the local API, which holds the
 * key and only lets the avatar speak lines the director already sent to this stage.
 */
export class ServiceStream {
  private pc: RTCPeerConnection | null = null;
  private streamId = "";
  private ready = false;
  private waiter: { done: () => void; timer: number } | null = null;
  private closed = false;
  private connecting: Promise<void> | null = null;

  constructor(
    private readonly characterId: string,
    private readonly video: HTMLVideoElement,
    private readonly onStatus: (s: Status, msg?: string) => void,
  ) {}

  connect(): Promise<void> {
    if (!this.connecting) this.connecting = this.open().finally(() => (this.connecting = null));
    return this.connecting;
  }

  private async open(): Promise<void> {
    this.teardown();
    this.onStatus("connecting");
    const init = await api<{ streamId: string; offer: RTCSessionDescriptionInit; iceServers: RTCIceServer[] }>("/avatar-service/streams", { body: { characterId: this.characterId } });
    if (this.closed) return;
    this.streamId = init.streamId;
    const pc = new RTCPeerConnection({ iceServers: init.iceServers });
    this.pc = pc;
    const dc = pc.createDataChannel("JanusDataChannel");
    dc.onmessage = (e) => this.onEvent(String(e.data));
    // Events may also arrive on a channel the service opens itself.
    pc.ondatachannel = (e) => (e.channel.onmessage = (m) => this.onEvent(String(m.data)));
    pc.ontrack = (e) => {
      if (e.streams[0] && this.video.srcObject !== e.streams[0]) {
        this.video.srcObject = e.streams[0];
        void this.video.play().catch(() => undefined);
      }
    };
    pc.onicecandidate = (e) => {
      const c = e.candidate;
      void api(`/avatar-service/streams/${this.streamId}/ice`, { body: c ? { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex } : {} }).catch(() => undefined);
    };
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === "connected") {
        // Warm-up ends with "stream/ready"; don't wait forever if that event is lost.
        window.setTimeout(() => this.markReady(), 5000);
      } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.ready = false;
        this.finishSpeech();
        if (!this.closed) this.onStatus("error", "การเชื่อมต่อวิดีโออวตารหลุด จะเชื่อมใหม่ตอนพูดประโยคถัดไป");
      }
    };
    await pc.setRemoteDescription(init.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await api(`/avatar-service/streams/${this.streamId}/sdp`, { body: { answer: { type: "answer", sdp: answer.sdp } } });
  }

  private markReady(): void {
    if (this.ready || this.closed) return;
    this.ready = true;
    this.onStatus("ready");
  }

  private onEvent(data: string): void {
    const [event] = data.split(":");
    if (event === "stream/ready") window.setTimeout(() => this.markReady(), 1000);
    else if (event === "stream/done" || event === "stream/error") this.finishSpeech();
  }

  private finishSpeech(): void {
    const w = this.waiter;
    if (!w) return;
    this.waiter = null;
    clearTimeout(w.timer);
    w.done();
  }

  private async waitReady(ms: number): Promise<void> {
    const until = Date.now() + ms;
    while (!this.ready && Date.now() < until && !this.closed) await new Promise((r) => setTimeout(r, 200));
    if (!this.ready) throw new Error("อวตารยังไม่พร้อม");
  }

  /** Speaks one line the director sent; resolves when the avatar has finished it. */
  async speak(segmentId: string, text: string): Promise<void> {
    if (!this.pc || this.pc.connectionState === "failed" || this.pc.connectionState === "closed") await this.connect();
    await this.waitReady(15_000);
    this.finishSpeech();
    let r: { duration: number | null };
    try {
      r = await api(`/avatar-service/streams/${this.streamId}/speak`, { body: { segmentId } });
    } catch (e) {
      // The service drops idle streams; reconnect once and try again.
      if ((e as { data?: unknown }).data === undefined) throw e;
      await this.connect();
      await this.waitReady(15_000);
      r = await api(`/avatar-service/streams/${this.streamId}/speak`, { body: { segmentId } });
    }
    // Thai is roughly 12 characters a second; allow for start-up delay before giving up on "stream/done".
    const expected = (r.duration ?? text.length / 12) * 1000 + 8000;
    await new Promise<void>((done) => {
      this.waiter = { done, timer: window.setTimeout(() => this.finishSpeech(), expected) };
    });
  }

  private teardown(): void {
    this.ready = false;
    this.finishSpeech();
    this.pc?.close();
    this.pc = null;
  }

  close(): void {
    this.closed = true;
    const id = this.streamId;
    this.teardown();
    this.onStatus("closed");
    if (id) void api(`/avatar-service/streams/${id}`, { method: "DELETE" }).catch(() => undefined);
  }
}
