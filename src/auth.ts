// Who may use the app (D11, D12). One password for the browser, bearer tokens for the CLI:
// "admin" (you) and "agent" (the pod, which may not send chat or manage logins).

import { core, getSetting, setSetting } from "./db";

export type Scope = "admin" | "agent";

const SESSION_DAYS = 30;
export const COOKIE = "life_session";

function sha256(s: string): string {
  return new Bun.CryptoHasher("sha256").update(s).digest("hex");
}

function randomToken(prefix: string): string {
  return prefix + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

export function hasPassword(): boolean {
  return getSetting("password") !== null;
}

export async function setPassword(pw: string) {
  if (pw.length < 8) throw new Error("use at least 8 characters");
  setSetting("password", await Bun.password.hash(pw));
  core.exec("DELETE FROM sessions");
}

// Failed logins per IP: after 5, each further try waits longer (1 min, 2, 4… up to an hour).
const fails = new Map<string, { n: number; until: number }>();

export async function login(pw: string, ip: string): Promise<{ token?: string; error?: string }> {
  const f = fails.get(ip);
  if (f && f.until > Date.now()) return { error: `too many tries; wait ${Math.ceil((f.until - Date.now()) / 1000)} s` };
  const hash = getSetting("password");
  if (!hash) return { error: "no password yet: run `life passwd` on the server" };
  if (!(await Bun.password.verify(pw, hash))) {
    const n = (f?.n ?? 0) + 1;
    fails.set(ip, { n, until: n >= 5 ? Date.now() + Math.min(60_000 * 2 ** (n - 5), 3_600_000) : 0 });
    return { error: "wrong password" };
  }
  fails.delete(ip);
  const token = randomToken("s_");
  const now = Date.now();
  core.query("INSERT INTO sessions (hash, created, expires) VALUES (?, ?, ?)").run(sha256(token), now, now + SESSION_DAYS * 86_400_000);
  core.query("DELETE FROM sessions WHERE expires < ?").run(now);
  return { token };
}

export function logout(token: string) {
  core.query("DELETE FROM sessions WHERE hash = ?").run(sha256(token));
}

export function sessionCookie(token: string, maxAge = SESSION_DAYS * 86_400): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function createToken(name: string, scope: Scope): string {
  const token = randomToken("life_");
  core.query("INSERT INTO tokens (hash, name, scope, created) VALUES (?, ?, ?, ?)").run(sha256(token), name, scope, Date.now());
  return token;
}

export function deleteTokens(name: string) {
  core.query("DELETE FROM tokens WHERE name = ?").run(name);
}

function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export function sessionToken(req: Request): string | null {
  return cookie(req, COOKIE);
}

/** The caller's scope, from a session cookie or a bearer token; null if neither is valid. */
export function who(req: Request): Scope | null {
  const bearer = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (bearer) {
    const row = core.query<{ scope: Scope }, [string]>("SELECT scope FROM tokens WHERE hash = ?").get(sha256(bearer));
    if (!row) return null;
    core.query("UPDATE tokens SET last_used = ? WHERE hash = ?").run(Date.now(), sha256(bearer));
    return row.scope;
  }
  const s = sessionToken(req);
  if (!s) return null;
  const row = core.query<{ expires: number }, [string]>("SELECT expires FROM sessions WHERE hash = ?").get(sha256(s));
  return row && row.expires > Date.now() ? "admin" : null;
}
