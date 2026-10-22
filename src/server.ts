// The Life server: the dashboard, its API, live events, and the agent behind the chat.
//
//   bun src/server.ts            (or: life serve)
//   LIFE_DATA, LIFE_HOST, LIFE_PORT, LIFE_MODEL, LIFE_DEV=1 (rebuild the UI on change)

import { watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeAgentProject } from "./agent";
import { COOKIE, createToken, deleteTokens, hasPassword, login, logout, sessionCookie, sessionToken, who } from "./auth";
import { help, parse, run } from "./commands";
import { DATA, HOST, PORT, paths } from "./config";
import { eventStream } from "./events";
import { compileWidget, watchLayer } from "./layer";

const DEV = process.env.LIFE_DEV === "1";

// ---------- the dashboard UI, built in memory ----------

type Asset = { body: Blob; type: string };
let assets = new Map<string, Asset>();
let stale = true;

async function buildWeb() {
  const r = await Bun.build({
    entrypoints: [join(paths.src, "web", "index.html")],
    target: "browser",
    minify: !DEV,
    define: { "process.env.NODE_ENV": JSON.stringify(DEV ? "development" : "production") },
    throw: false,
  });
  if (!r.success) {
    console.error("life: the UI didn't build:\n" + r.logs.map(String).join("\n"));
    if (!assets.size) throw new Error("the UI didn't build");
    return;
  }
  const next = new Map<string, Asset>();
  for (const o of r.outputs) next.set(o.path.replace(/^\.\//, "/"), { body: o, type: o.type });
  assets = next;
  stale = false;
}

async function asset(path: string): Promise<Asset | undefined> {
  if (stale) await buildWeb();
  return assets.get(path === "/" ? "/index.html" : path);
}

if (DEV) watch(join(paths.src, "web"), { recursive: true }, () => (stale = true));

// ---------- responses ----------

const SECURITY = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' blob:", // widgets load as blob: modules
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'", // widget code can't send your data anywhere else
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; "),
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function secure(res: Response): Response {
  for (const [k, v] of Object.entries(SECURITY)) res.headers.set(k, v);
  return res;
}

const ok = (data: unknown, init?: ResponseInit) => Response.json(data, init);
const fail = (status: number, error: string) => Response.json({ error }, { status });

async function body(req: Request): Promise<any> {
  // JSON only: a cross-site form can't send it without a CORS preflight.
  if (!req.headers.get("content-type")?.startsWith("application/json")) throw new Error("send JSON");
  return req.json();
}

// ---------- the API ----------

async function api(req: Request, url: URL, ip: string, server: Bun.Server<unknown>): Promise<Response> {
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /api/me") return ok({ authed: who(req) !== null, hasPassword: hasPassword() });
  if (route === "POST /api/login") {
    const { password } = await body(req);
    const r = await login(String(password ?? ""), ip);
    if (!r.token) return fail(401, r.error!);
    return ok({ ok: true }, { headers: { "set-cookie": sessionCookie(r.token) } });
  }
  if (route === "POST /api/logout") {
    const t = sessionToken(req);
    if (t) logout(t);
    return ok({ ok: true }, { headers: { "set-cookie": `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` } });
  }

  const scope = who(req);
  if (!scope) return fail(401, "sign in first");

  if (route === "GET /api/events") {
    server.timeout(req, 0);
    return eventStream();
  }
  const w = /^\/api\/widget\/([^/]+)$/.exec(url.pathname);
  if (req.method === "GET" && w) return ok(await compileWidget(decodeURIComponent(w[1]!)));

  if (route === "POST /api/cmd") {
    const { name, args } = await body(req);
    const out = await run(String(name), args ?? {}, scope);
    return ok(out);
  }
  if (route === "POST /api/cli") {
    const { argv } = await body(req);
    if (!Array.isArray(argv)) return fail(400, "argv must be a list");
    const p = parse(argv.map(String));
    if (!("cmd" in p)) return ok({ text: p.text || help(scope), fail: p.fail });
    return ok(await run(p.cmd.name, p.args, scope));
  }
  return fail(404, "no such endpoint");
}

// ---------- start ----------

writeAgentProject();
watchLayer();
await buildWeb();

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: 60,
  async fetch(req, server) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) return secure(await api(req, url, server.requestIP(req)?.address ?? "?", server));
      if (req.method !== "GET" && req.method !== "HEAD") return secure(new Response(null, { status: 405 }));
      const a = await asset(url.pathname);
      if (!a) return secure(new Response("not found", { status: 404 }));
      return secure(new Response(a.body, { headers: { "content-type": a.type, "cache-control": url.pathname === "/" ? "no-cache" : "public, max-age=31536000, immutable" } }));
    } catch (e) {
      return secure(fail(400, (e as Error).message ?? String(e)));
    }
  },
});

// The CLI on this machine finds the server and an admin token here.
const local = `http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}`;
deleteTokens("local");
writeFileSync(paths.localCli, JSON.stringify({ url: local, token: createToken("local", "admin") }) + "\n", { mode: 0o600 });

console.log(`life: serving http://${server.hostname}:${server.port} (data in ${DATA})`);
if (!hasPassword()) console.log("life: no password yet. Set one with: life passwd");
