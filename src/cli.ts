#!/usr/bin/env bun
// life: the command line for Life. Everything the dashboard can do, from a terminal (D3).
//
//   life <command> [args] [--flags]    runs a command on the server (`life help` lists them)
//   life serve                         starts the server
//   life passwd                        sets the dashboard password        ┐ on the server's
//   life token create|revoke <name>    tokens for using the CLI elsewhere ┘ machine only
//   life remote <url> <token>          points this machine's CLI at a server
//
// Global flags: --json (raw data), --config <file>. The server is found from --config,
// then LIFE_URL + LIFE_TOKEN, then ~/.config/life/cli.json, then the local server's
// own <data>/cli.json. No dependencies: the agent runs this inside its pod.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

type Config = { url: string; token: string };
const USER_CONFIG = join(homedir(), ".config", "life", "cli.json");

function die(msg: string): never {
  console.error(`life: ${msg}`);
  process.exit(1);
}

function config(flag?: string): Config {
  const read = (f: string): Config => {
    try {
      return JSON.parse(readFileSync(f, "utf8"));
    } catch (e) {
      die(`can't read ${f}: ${(e as Error).message}`);
    }
  };
  if (flag) return read(flag);
  if (process.env.LIFE_URL && process.env.LIFE_TOKEN) return { url: process.env.LIFE_URL, token: process.env.LIFE_TOKEN };
  if (existsSync(USER_CONFIG)) return read(USER_CONFIG);
  const local = join(resolve(process.env.LIFE_DATA ?? join(import.meta.dir, "..", "data")), "cli.json");
  if (existsSync(local)) return read(local);
  die("no server configured. Start one here (life serve), or run: life remote <url> <token>");
}

async function readStdin(): Promise<string> {
  return (await new Response(Bun.stdin.stream()).text()).replace(/\n$/, "");
}

async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) return readStdin();
  process.stdout.write(prompt);
  Bun.spawnSync(["stty", "-echo"], { stdin: "inherit" });
  try {
    for await (const line of console) return line;
    return "";
  } finally {
    Bun.spawnSync(["stty", "echo"], { stdin: "inherit" });
    process.stdout.write("\n");
  }
}

// ---------- commands that work on this machine's data directly ----------

async function local(argv: string[]): Promise<boolean> {
  const [cmd, sub, name] = argv;
  if (cmd === "serve") {
    await import("./server");
    return true;
  }
  if (cmd === "passwd") {
    const { setPassword } = await import("./auth");
    const pw = await readSecret("New dashboard password: ");
    if (process.stdin.isTTY && (await readSecret("Again: ")) !== pw) die("the passwords don't match");
    await setPassword(pw).catch((e) => die(e.message));
    console.log("password set; everyone signed in has been signed out");
    return true;
  }
  if (cmd === "token") {
    const { createToken, deleteTokens } = await import("./auth");
    if (!name || !["create", "revoke"].includes(sub ?? "")) die("usage: life token create <name> | life token revoke <name>");
    if (["agent", "local"].includes(name)) die(`"${name}" is reserved`);
    if (sub === "revoke") {
      deleteTokens(name);
      console.log(`revoked every token named "${name}"`);
      return true;
    }
    const { HOST, PORT } = await import("./config");
    console.log(`On the other machine, run:\n\n  life remote http://${HOST === "0.0.0.0" ? "<this server's IP>" : HOST}:${PORT} ${createToken(name, "admin")}\n`);
    return true;
  }
  if (cmd === "remote") {
    if (!sub || !name) die("usage: life remote <url> <token>");
    mkdirSync(dirname(USER_CONFIG), { recursive: true });
    writeFileSync(USER_CONFIG, JSON.stringify({ url: sub.replace(/\/$/, ""), token: name }) + "\n", { mode: 0o600 });
    chmodSync(USER_CONFIG, 0o600);
    console.log(`this machine's life CLI now uses ${sub}`);
    return true;
  }
  return false;
}

// ---------- everything else runs on the server ----------

async function follow(c: Config): Promise<() => Promise<void>> {
  const res = await fetch(`${c.url}/api/events`, { headers: { authorization: `Bearer ${c.token}` } });
  if (!res.ok || !res.body) die(`can't follow the agent (${res.status})`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  return async () => {
    let buf = "";
    let answer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (!chunk.startsWith("data: ")) continue;
        const e = JSON.parse(chunk.slice(6));
        if (e.type === "agent" && e.kind === "tool") console.error(`  · ${e.text}`);
        if (e.type === "chat" && e.message?.role === "agent") answer = e.message.text;
        if (e.type === "turn" && e.state === "end") {
          console.log(answer);
          reader.cancel();
          process.exit(e.error ? 1 : 0);
        }
      }
    }
  };
}

async function main() {
  const all = process.argv.slice(2);
  const argv: string[] = [];
  let json = false;
  let configFlag: string | undefined;
  for (let i = 0; i < all.length; i++) {
    if (all[i] === "--json") json = true;
    else if (all[i] === "--config") configFlag = all[++i];
    else argv.push(all[i]!);
  }
  if (await local(argv)) return;

  const dash = argv.indexOf("-");
  if (dash >= 0) argv[dash] = await readStdin();

  const c = config(configFlag);
  const turn = argv[0] === "chat" && argv[1] === "send" && !argv.includes("--help") ? await follow(c) : null;
  let res: Response;
  try {
    res = await fetch(`${c.url}/api/cli`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${c.token}` },
      body: JSON.stringify({ argv }),
    });
  } catch (e) {
    die(`can't reach the server at ${c.url} (${(e as Error).message})`);
  }
  const out: any = await res.json().catch(() => ({ error: `the server answered ${res.status}` }));
  if (!res.ok) die(out.error ?? res.statusText);
  if (out.follow === "turn" && turn) return turn();
  if (json) console.log(JSON.stringify(out.data ?? null, null, 2));
  else if (out.text !== undefined) console.log(out.text);
  else console.log(JSON.stringify(out.data ?? null, null, 2));
  if (out.fail) process.exit(1);
}

await main();
