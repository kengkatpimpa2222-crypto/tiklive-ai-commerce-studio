export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { data });
  return data;
}

export function wsUrl(): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

/** Reconnecting WebSocket. Returns a send function and a disposer. */
export function connect(role: "stage" | "preview" | "control", onMessage: (m: any) => void): { send: (m: unknown) => void; close: () => void } {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: number | undefined;
  const open = () => {
    ws = new WebSocket(wsUrl());
    ws.onopen = () => ws?.send(JSON.stringify({ type: "hello", role }));
    ws.onmessage = (e) => onMessage(JSON.parse(e.data as string));
    ws.onclose = () => {
      if (!closed) retry = window.setTimeout(open, 1000);
    };
  };
  open();
  return {
    send: (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m)),
    close: () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    },
  };
}
