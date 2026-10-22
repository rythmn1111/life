// Live updates to every open dashboard and CLI, as server-sent events.

export type LifeEvent =
  | { type: "layer" }
  | { type: "data" }
  | { type: "theme" }
  | { type: "chat"; message: unknown }
  | { type: "turn"; state: "start" | "end"; error?: boolean }
  | { type: "agent"; kind: "text" | "tool" | "log"; text: string };

const encoder = new TextEncoder();
const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const listeners = new Set<(e: LifeEvent) => void>();

export function broadcast(e: LifeEvent) {
  const chunk = encoder.encode(`data: ${JSON.stringify(e)}\n\n`);
  for (const c of clients) {
    try {
      c.enqueue(chunk);
    } catch {
      clients.delete(c);
    }
  }
  for (const fn of listeners) fn(e);
}

/** In-process listeners (the agent runner, tests). Returns a function that stops listening. */
export function listen(fn: (e: LifeEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function eventStream(): Response {
  let self: ReadableStreamDefaultController<Uint8Array>;
  let ping: ReturnType<typeof setInterval>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      self = c;
      clients.add(c);
      c.enqueue(encoder.encode(": hello\n\n"));
      ping = setInterval(() => {
        try {
          c.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(ping);
          clients.delete(c);
        }
      }, 20_000);
    },
    cancel() {
      clearInterval(ping);
      clients.delete(self);
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
}
