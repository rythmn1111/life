// The browser's side of the API: commands (D3) and live events.

export type LifeEvent =
  | { type: "layer" }
  | { type: "data" }
  | { type: "theme" }
  | { type: "chat"; message: any }
  | { type: "turn"; state: "start" | "end"; error?: boolean }
  | { type: "agent"; kind: "text" | "tool" | "log"; text: string };

/** Runs a command (the same ones as the `life` CLI) and returns its data. */
export async function cmd<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch("/api/cmd", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, args }) });
  const j = await r.json().catch(() => ({ error: r.statusText }));
  if (r.status === 401) location.reload();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j.data as T;
}

const handlers = new Set<(e: LifeEvent) => void>();
let source: EventSource | null = null;

function emit(e: LifeEvent) {
  for (const fn of handlers) fn(e);
}

/** Listens to live events; returns a function that stops listening. */
export function onLife(fn: (e: LifeEvent) => void): () => void {
  if (!source) {
    let opened = false;
    source = new EventSource("/api/events");
    source.onmessage = (m) => emit(JSON.parse(m.data));
    source.onopen = () => {
      // After a reconnect (e.g. the server restarted), anything may have changed.
      if (opened) for (const type of ["layer", "data", "theme"] as const) emit({ type });
      if (opened) emit({ type: "chat", message: null });
      opened = true;
    };
  }
  handlers.add(fn);
  return () => handlers.delete(fn);
}
