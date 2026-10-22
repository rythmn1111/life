// Vendored from github.com/rythmn1111/agentpod, packages/agentpod/src/index.ts (commit 7d989e8).
// The client for `apod serve --stdio`. Update by copying the file again; don't edit it here.

// agentpod for apps: a thin client for the agentpod engine on this machine (D19).
//
// The library never installs anything quietly (D24). If agentpod is missing, it
// tells you what to ask the user; if your app isn't approved yet, the user approves
// it in their terminal (D21). Works on Node and Bun.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";

/** 2: calls carry an id, so each call's events can be told apart. */
export const PROTOCOL = 2;

export interface AppInfo {
  /** Stable id, e.g. "com.example.todo": letters, digits, '.', '-', '_' */
  id: string;
  /** What the user sees, e.g. "TodoApp" */
  name: string;
}

export interface Window {
  path: string;
  access?: "ro" | "rw";
}

export interface ConnectOptions {
  app: AppInfo;
  /** A folder with an apod.toml. */
  project?: string;
  /** Or a single pod with no apod.toml (D35). */
  solo?: { name?: string; harness: "claude" | "codex" | "cursor"; model?: string; windows?: Window[] };
  /** Path to the apod binary (default: $APOD_BIN, ~/.agentpod/bin/apod, then PATH). */
  apod?: string;
  /** Every event of every run. */
  onEvent?: (e: PodEvent) => void;
  /** Extra environment for the engine (e.g. AGENTPOD_HOME in tests). */
  env?: Record<string, string>;
}

export type Event =
  | { kind: "started"; session: string | null; model: string | null }
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; input: string }
  | { kind: "tool_result"; text: string; error: boolean }
  | { kind: "result"; text: string; error: boolean; cost_usd: number | null }
  | { kind: "log"; text: string };

export type PodEvent = Event & { ts: number; run: string; pod: string; depth: number; call?: string };

export interface RunOutput {
  run: string;
  pod: string;
  text: string;
  error: boolean;
  session: string | null;
  cost_usd: number | null;
}

export interface TeamInfo {
  name: string;
  project: string;
  pods: { name: string; harness: string; bosses: string[]; in_charge: string[]; windows: { path: string; access: "ro" | "rw" }[] }[];
  /** from → to → capabilities */
  links: Record<string, Record<string, string[]>>;
}

export class AgentpodError extends Error {
  constructor(message: string, readonly code: number) {
    super(message);
    this.name = "AgentpodError";
  }
}

/** agentpod isn't on this machine. Ask the user with `prompt` before installing anything (D24). */
export class NotInstalledError extends Error {
  constructor(readonly prompt: string) {
    super(`agentpod isn't installed. Ask the user first: "${prompt}"`);
    this.name = "NotInstalledError";
  }
}

/** The user hasn't approved this app yet. They run `approveCommand` in their terminal. */
export class NotApprovedError extends AgentpodError {
  constructor(message: string, readonly approveCommand: string) {
    super(message, -32001);
    this.name = "NotApprovedError";
  }
}

/** The question an app must ask before installing agentpod (D24). */
export function installPrompt(appName: string): string {
  return `${appName} uses agentpod to run AI on your machine with your own subscriptions. Install it?`;
}

/** Finds the apod binary, or null. */
export function findApod(explicit?: string): string | null {
  if (explicit) return existsSync(explicit) ? explicit : null;
  const candidates = [process.env.APOD_BIN, join(homedir(), ".agentpod", "bin", "apod")];
  for (const c of candidates) if (c && existsSync(c)) return c;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const p = join(dir, "apod");
    if (dir && existsSync(p)) return p;
  }
  return null;
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export class Agentpod {
  #proc: ChildProcessWithoutNullStreams;
  #next = 1;
  #pending = new Map<number, Pending>();
  #listeners = new Set<(e: PodEvent) => void>();
  #closed = false;
  #stderr = "";
  team!: TeamInfo;
  version!: string;

  private constructor(proc: ChildProcessWithoutNullStreams) {
    this.#proc = proc;
    createInterface({ input: proc.stdout }).on("line", (line) => this.#onLine(line));
    proc.stderr.on("data", (d) => {
      this.#stderr = (this.#stderr + d.toString()).slice(-4000);
    });
    proc.on("exit", (code) => {
      this.#closed = true;
      const err = new AgentpodError(`the agentpod engine exited (${code})${this.#stderr ? `: ${this.#stderr.trim()}` : ""}`, -32003);
      for (const p of this.#pending.values()) p.reject(err);
      this.#pending.clear();
    });
  }

  static async connect(opts: ConnectOptions): Promise<Agentpod> {
    const bin = findApod(opts.apod);
    if (!bin) throw new NotInstalledError(installPrompt(opts.app.name));
    const proc = spawn(bin, ["serve", "--stdio"], { env: { ...process.env, ...opts.env }, stdio: ["pipe", "pipe", "pipe"] });
    const ap = new Agentpod(proc);
    if (opts.onEvent) ap.onEvent(opts.onEvent);
    try {
      const init = await ap.#request("initialize", { app: opts.app, project: opts.project, solo: opts.solo });
      if (init.protocol !== PROTOCOL)
        throw new AgentpodError(
          `the installed agentpod speaks protocol ${init.protocol}; this library needs ${PROTOCOL}. Update agentpod (it updates itself, D29) or the library.`,
          -32004,
        );
      ap.team = init.team;
      ap.version = init.agentpod;
      return ap;
    } catch (e) {
      ap.close();
      throw e;
    }
  }

  /** Listen to every event; returns a function that stops listening. */
  onEvent(fn: (e: PodEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /** Give a pod a task and wait for its answer. This call's events (and only this call's)
   * stream to `opts.onEvent` meanwhile; every event also goes to the connection's listeners. */
  async call(pod: string, task: string, opts: { onEvent?: (e: PodEvent) => void } = {}): Promise<RunOutput> {
    const call = `c${this.#next}-${Math.random().toString(36).slice(2, 10)}`;
    const fn = opts.onEvent;
    const off = fn ? this.onEvent((e) => e.call === call && fn(e)) : undefined;
    try {
      return await this.#request("pod.call", { pod, task, call });
    } finally {
      off?.();
    }
  }

  async stop(pod: string): Promise<number> {
    return (await this.#request("pod.stop", { pod })).stopped;
  }

  async status(): Promise<{ harnesses: { name: string; installed: string | null; logged_in: boolean; login: string }[] }> {
    return this.#request("status", {});
  }

  close(): void {
    if (!this.#closed) this.#proc.stdin.end();
    this.#closed = true;
  }

  #request(method: string, params: unknown): Promise<any> {
    if (this.#closed) return Promise.reject(new AgentpodError("connection closed", -32003));
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  #onLine(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.method === "pod.event") {
      for (const fn of this.#listeners) fn(msg.params);
      return;
    }
    const p = this.#pending.get(msg.id);
    if (!p) return;
    this.#pending.delete(msg.id);
    if (msg.error) {
      const { code, message } = msg.error;
      if (code === -32001) {
        const m = /apod apps approve \S+/.exec(message);
        p.reject(new NotApprovedError(message, m ? m[0] : "apod apps approve <id>"));
      } else p.reject(new AgentpodError(message, code));
    } else p.resolve(msg.result);
  }
}

/** Connects to agentpod on this machine. */
export function connect(opts: ConnectOptions): Promise<Agentpod> {
  return Agentpod.connect(opts);
}
