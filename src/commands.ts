// The command layer (D3): every action of the app, used by the UI (/api/cmd) and the CLI
// (/api/cli, which parses argv here so the CLI never falls out of date).

import { agentStatus, clearHistory, history, send, stop } from "./agent";
import type { Scope } from "./auth";
import { exec, query, tables } from "./db";
import { broadcast } from "./events";
import {
  ID,
  STARTER,
  VARIANTS,
  type Layout,
  compileWidget,
  readLayout,
  readTheme,
  restore,
  snapshot,
  undo,
  versions,
  widgetFile,
  writeLayout,
  writeTheme,
} from "./layer";
import { existsSync, rmSync, writeFileSync } from "node:fs";

type Param = { name: string; summary: string; optional?: boolean; rest?: boolean };
type Flag = { name: string; summary: string; type: "string" | "number" | "boolean" };
export type Out = { text?: string; data?: unknown; fail?: boolean; follow?: "turn" };
export type Command = {
  name: string;
  summary: string;
  args?: Param[];
  flags?: Flag[];
  /** Only you, not the agent (D10). */
  admin?: boolean;
  run(a: Record<string, any>, ctx: { scope: Scope }): Out | Promise<Out>;
};

const json = (v: unknown) => JSON.stringify(v, null, 2);

function params(p: unknown): unknown[] | Record<string, unknown> | undefined {
  if (p === undefined || p === null || p === "") return undefined;
  if (typeof p !== "string") return p as any;
  try {
    return JSON.parse(p);
  } catch {
    throw new Error(`--params must be JSON, e.g. '[1, "text"]' or '{"name": "x"}'`);
  }
}

/** Rows as an aligned text table. */
function table(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "(no rows)";
  const cols = Object.keys(rows[0]!);
  const cell = (v: unknown) => (v === null ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/\n/g, "⏎");
  const w = cols.map((c) => Math.min(40, Math.max(c.length, ...rows.map((r) => cell(r[c]).length))));
  const line = (vals: string[]) => vals.map((v, i) => (v.length > w[i]! ? v.slice(0, w[i]! - 1) + "…" : v.padEnd(w[i]!))).join("  ").trimEnd();
  return [line(cols), line(w.map((n) => "─".repeat(n))), ...rows.map((r) => line(cols.map((c) => cell(r[c]))))].join("\n");
}

function layoutOrThrow(): Layout {
  return readLayout();
}

function find(l: Layout, id: string) {
  const i = l.widgets.findIndex((w) => w.id === id);
  if (i < 0) throw new Error(`"${id}" isn't on the dashboard (see: life widget list)`);
  return i;
}

function span(v: unknown): 1 | 2 | 3 {
  const n = Number(v);
  if (![1, 2, 3].includes(n)) throw new Error("--span is 1, 2 or 3 (columns)");
  return n as 1 | 2 | 3;
}

export const commands: Command[] = [
  {
    name: "status",
    summary: "What's on the dashboard, and what the agent is doing",
    run() {
      let widgets = 0;
      try {
        widgets = readLayout().widgets.length;
      } catch {}
      const t = tables();
      const a = agentStatus();
      return {
        data: { widgets, tables: t.length, versions: versions().length, agent: a },
        text: `Life: ${widgets} widgets, ${t.length} tables, ${versions().length} versions. Agent (${a.model}): ${a.busy ? "working" : "idle"}.`,
      };
    },
  },

  // ---------- custom.db (D8) ----------
  {
    name: "db.tables",
    summary: "The tables in custom.db, with their columns and row counts",
    run() {
      const t = tables();
      return {
        data: t,
        text: t.length
          ? t.map((x) => `${x.name} (${x.rows} rows)\n${x.columns.map((c) => `  ${c.name} ${c.type}${c.pk ? " PRIMARY KEY" : ""}${c.notnull ? " NOT NULL" : ""}`).join("\n")}`).join("\n\n")
          : "custom.db has no tables yet",
      };
    },
  },
  {
    name: "db.query",
    summary: "Read rows from custom.db (read-only; `-` reads the SQL from stdin)",
    args: [{ name: "sql", summary: "a SELECT (or WITH …), e.g. \"SELECT * FROM water_log LIMIT 10\"" }],
    flags: [{ name: "params", type: "string", summary: "JSON values for ? or :name placeholders" }],
    run(a) {
      const rows = query(a.sql, params(a.params));
      return { data: rows, text: table(rows) };
    },
  },
  {
    name: "db.exec",
    summary: "Change custom.db: CREATE TABLE, INSERT, UPDATE, DELETE… (`-` reads the SQL from stdin)",
    args: [{ name: "sql", summary: "one statement with --params, or several separated by ;" }],
    flags: [{ name: "params", type: "string", summary: "JSON values for ? or :name placeholders" }],
    run(a) {
      const r = exec(a.sql, params(a.params));
      broadcast({ type: "data" });
      return { data: r, text: `ok: ${r.changes} row(s) changed${r.lastInsertRowid ? `, last id ${r.lastInsertRowid}` : ""}` };
    },
  },

  // ---------- widgets (D4, D5) ----------
  {
    name: "widget.list",
    summary: "The widgets on the dashboard, in order",
    run() {
      const layout = layoutOrThrow();
      const rows = layout.widgets.map((w, i) => ({ position: i + 1, id: w.id, title: w.title, span: w.span, file: existsSync(widgetFile(w.id)) ? `widgets/${w.id}.tsx` : "(missing)" }));
      return { data: { layout }, text: rows.length ? table(rows) : "no widgets yet" };
    },
  },
  {
    name: "widget.add",
    summary: "Put a widget on the dashboard (creates widgets/<id>.tsx from a starter if it doesn't exist)",
    args: [{ name: "id", summary: "lowercase letters, digits, - and _, e.g. water" }],
    flags: [
      { name: "title", type: "string", summary: "the card's title (default: the id)" },
      { name: "span", type: "number", summary: "columns it takes: 1, 2 or 3 (default 1)" },
      { name: "at", type: "number", summary: "position, 1 = first (default: last)" },
    ],
    run(a) {
      if (!ID.test(a.id)) throw new Error(`widget ids match ${ID}`);
      const l = layoutOrThrow();
      if (l.widgets.some((w) => w.id === a.id)) throw new Error(`"${a.id}" is already on the dashboard`);
      const created = !existsSync(widgetFile(a.id));
      if (created) writeFileSync(widgetFile(a.id), STARTER);
      const entry = { id: a.id, title: a.title ?? a.id, span: a.span === undefined ? 1 : span(a.span) };
      const at = a.at === undefined ? l.widgets.length : Math.max(0, Math.min(l.widgets.length, Number(a.at) - 1));
      l.widgets.splice(at, 0, entry);
      writeLayout(l);
      return { data: entry, text: `added "${a.id}" at position ${at + 1}${created ? ` (created widgets/${a.id}.tsx)` : ""}` };
    },
  },
  {
    name: "widget.set",
    summary: "Change a widget's title or width",
    args: [{ name: "id", summary: "the widget" }],
    flags: [
      { name: "title", type: "string", summary: "the card's title" },
      { name: "span", type: "number", summary: "columns: 1, 2 or 3" },
    ],
    run(a) {
      const l = layoutOrThrow();
      const w = l.widgets[find(l, a.id)]!;
      if (a.title !== undefined) w.title = String(a.title);
      if (a.span !== undefined) w.span = span(a.span);
      writeLayout(l);
      return { data: w, text: `"${w.id}": title "${w.title}", span ${w.span}` };
    },
  },
  {
    name: "widget.move",
    summary: "Move a widget to another position",
    args: [
      { name: "id", summary: "the widget" },
      { name: "position", summary: "1 = first" },
    ],
    run(a) {
      const l = layoutOrThrow();
      const [w] = l.widgets.splice(find(l, a.id), 1);
      const to = Math.max(0, Math.min(l.widgets.length, Number(a.position) - 1));
      l.widgets.splice(to, 0, w!);
      writeLayout(l);
      return { text: `moved "${a.id}" to position ${to + 1}` };
    },
  },
  {
    name: "widget.remove",
    summary: "Take a widget off the dashboard (its file stays unless --delete-file)",
    args: [{ name: "id", summary: "the widget" }],
    flags: [{ name: "delete-file", type: "boolean", summary: "also delete widgets/<id>.tsx" }],
    run(a) {
      const l = layoutOrThrow();
      l.widgets.splice(find(l, a.id), 1);
      writeLayout(l);
      if (a["delete-file"]) rmSync(widgetFile(a.id), { force: true });
      return { text: `removed "${a.id}"${a["delete-file"] ? " and its file" : ""}` };
    },
  },
  {
    name: "widget.check",
    summary: "Compile widgets and report errors (one widget, or every widget on the dashboard)",
    args: [{ name: "id", summary: "the widget (default: all)", optional: true }],
    async run(a) {
      const ids = a.id ? [a.id] : layoutOrThrow().widgets.map((w) => w.id);
      const results = await Promise.all(ids.map(async (id) => ({ id, ...(await compileWidget(id)) })));
      const bad = results.filter((r) => "error" in r);
      return {
        data: results.map((r) => ({ id: r.id, ok: !("error" in r), error: "error" in r ? r.error : undefined })),
        text: results.length ? results.map((r) => ("error" in r ? `✗ ${r.id}\n${r.error.replace(/^/gm, "    ")}` : `✓ ${r.id}`)).join("\n") : "no widgets to check",
        fail: bad.length > 0,
      };
    },
  },

  // ---------- theme ----------
  {
    name: "theme.get",
    summary: "The dashboard's colors: seed color, scheme variant and light/dark mode",
    run() {
      const t = readTheme();
      return { data: t, text: `seed ${t.seed}, variant ${t.variant}, mode ${t.mode}` };
    },
  },
  {
    name: "theme.set",
    summary: "Change the dashboard's colors (Material 3 dynamic color from one seed)",
    flags: [
      { name: "seed", type: "string", summary: "a hex color, e.g. #2E7D32" },
      { name: "variant", type: "string", summary: VARIANTS.join(" | ") },
      { name: "mode", type: "string", summary: "auto | light | dark" },
    ],
    run(a) {
      const t = readTheme();
      if (a.seed !== undefined) {
        if (!/^#[0-9a-fA-F]{6}$/.test(a.seed)) throw new Error("--seed is a hex color like #2E7D32");
        t.seed = a.seed;
      }
      if (a.variant !== undefined) {
        if (!VARIANTS.includes(a.variant)) throw new Error(`--variant is one of: ${VARIANTS.join(", ")}`);
        t.variant = a.variant;
      }
      if (a.mode !== undefined) {
        if (!["auto", "light", "dark"].includes(a.mode)) throw new Error("--mode is auto, light or dark");
        t.mode = a.mode;
      }
      writeTheme(t);
      return { data: t, text: `seed ${t.seed}, variant ${t.variant}, mode ${t.mode}` };
    },
  },

  // ---------- versions (D7) ----------
  {
    name: "version.list",
    summary: "Saved versions of the personal layer, newest first",
    run() {
      const v = versions();
      return { data: v, text: v.length ? table(v.map((x) => ({ id: x.id, when: new Date(x.ts).toLocaleString(), label: x.label }))) : "no versions yet" };
    },
  },
  {
    name: "version.save",
    summary: "Save the personal layer (widgets, layout, theme and custom.db) as a version",
    args: [{ name: "label", summary: "what this version is", optional: true, rest: true }],
    run(a) {
      const id = snapshot(a.label || "saved by hand");
      return { data: { id }, text: `saved version ${id}` };
    },
  },
  {
    name: "version.restore",
    summary: "Go back to a version (the current state is saved first, so `life undo` reverses this)",
    args: [{ name: "id", summary: "from life version list" }],
    flags: [{ name: "with-data", type: "boolean", summary: "also restore custom.db (data entered since then is lost)" }],
    run(a) {
      const id = Number(a.id);
      if (!versions().some((v) => v.id === id)) throw new Error(`there's no version ${a.id}`);
      snapshot(`before restoring version ${id}`);
      restore(id, !!a["with-data"]);
      return { text: `restored version ${id}${a["with-data"] ? " with its data" : " (widgets, layout and theme; data untouched)"}` };
    },
  },
  {
    name: "undo",
    summary: "Roll back to the newest version and drop it (repeat to go further back)",
    flags: [{ name: "with-data", type: "boolean", summary: "also restore custom.db" }],
    run(a) {
      const v = undo(!!a["with-data"]);
      return { data: v, text: `rolled back to "${v.label}"` };
    },
  },

  // ---------- chat with the agent (D10) ----------
  {
    name: "chat.history",
    summary: "The conversation with the agent",
    flags: [{ name: "limit", type: "number", summary: "how many messages (default 30)" }],
    run(a) {
      const h = history(a.limit ? Number(a.limit) : 30);
      return { data: h, text: h.length ? h.map((m) => `${m.role === "user" ? "You" : "Agent"}: ${m.text}`).join("\n\n") : "no messages yet" };
    },
  },
  {
    name: "chat.send",
    summary: "Ask the agent something; it may change the dashboard",
    args: [{ name: "message", summary: "what you want", rest: true }],
    admin: true,
    run(a) {
      return { data: send(String(a.message)), follow: "turn" };
    },
  },
  {
    name: "chat.stop",
    summary: "Stop the agent's current turn",
    admin: true,
    async run() {
      const n = await stop();
      return { data: { stopped: n }, text: n ? "stopped" : "the agent wasn't running" };
    },
  },
  {
    name: "chat.clear",
    summary: "Forget the conversation (the dashboard stays as it is)",
    admin: true,
    run() {
      clearHistory();
      return { text: "conversation cleared" };
    },
  },
  {
    name: "agent.status",
    summary: "Whether the agent is working, and its model",
    run() {
      const s = agentStatus();
      return { data: s, text: `${s.model}: ${s.busy ? "working" : "idle"}` };
    },
  },
];

const byName = new Map(commands.map((c) => [c.name, c]));

export function usage(c: Command): string {
  const args = (c.args ?? []).map((p) => (p.optional ? `[${p.name}${p.rest ? "…" : ""}]` : `<${p.name}${p.rest ? "…" : ""}>`)).join(" ");
  const lines = [`life ${c.name.replace(/\./g, " ")}${args ? " " + args : ""}${c.flags?.length ? " [flags]" : ""}`, `  ${c.summary}`];
  for (const p of c.args ?? []) lines.push(`  ${p.name.padEnd(14)} ${p.summary}`);
  for (const f of c.flags ?? []) lines.push(`  --${(f.name + (f.type === "boolean" ? "" : ` <${f.type}>`)).padEnd(12)} ${f.summary}`);
  return lines.join("\n");
}

export function help(scope: Scope): string {
  const visible = commands.filter((c) => scope === "admin" || !c.admin);
  return [
    "life <command> [args] [--flags]     (life <command> --help for details)",
    "",
    ...visible.map((c) => `  ${c.name.replace(/\./g, " ").padEnd(18)} ${c.summary}`),
    "",
    "On the server's machine only: life serve | passwd | token create <name> | token revoke <name> | remote <url> <token>",
  ].join("\n");
}

/** argv (after `life`) → a command and its arguments. */
export function parse(argv: string[]): { cmd: Command; args: Record<string, any> } | { text: string; fail?: boolean } {
  const words: string[] = [];
  let i = 0;
  while (i < argv.length && !argv[i]!.startsWith("--")) words.push(argv[i++]!);
  let cmd: Command | undefined;
  let used = 0;
  for (let n = Math.min(3, words.length); n > 0 && !cmd; n--) {
    cmd = byName.get(words.slice(0, n).join("."));
    if (cmd) used = n;
  }
  if (!cmd) {
    if (!words.length || words[0] === "help") return { text: "" };
    return { text: `unknown command "${words.join(" ")}". See: life help`, fail: true };
  }
  const positional = words.slice(used);
  const args: Record<string, any> = {};
  while (i < argv.length) {
    const tok = argv[i++]!;
    if (!tok.startsWith("--")) {
      positional.push(tok);
      continue;
    }
    const [name, inline] = tok.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (name === "help") return { text: usage(cmd) };
    const f = cmd.flags?.find((x) => x.name === name);
    if (!f) return { text: `unknown flag --${name}\n\n${usage(cmd)}`, fail: true };
    if (f.type === "boolean") args[name] = inline === undefined ? true : inline !== "false";
    else {
      const v = inline ?? argv[i++];
      if (v === undefined) return { text: `--${name} needs a value\n\n${usage(cmd)}`, fail: true };
      args[name] = f.type === "number" ? Number(v) : v;
    }
  }
  const ps = cmd.args ?? [];
  for (const [k, p] of ps.entries()) {
    if (p.rest) {
      const rest = positional.slice(k);
      if (rest.length) args[p.name] = rest.join(" ");
    } else if (positional[k] !== undefined) args[p.name] = positional[k];
    if (args[p.name] === undefined && !p.optional) return { text: `missing <${p.name}>\n\n${usage(cmd)}`, fail: true };
  }
  if (!ps.some((p) => p.rest) && positional.length > ps.length) return { text: `too many arguments (quote text with spaces)\n\n${usage(cmd)}`, fail: true };
  return { cmd, args };
}

export async function run(name: string, args: Record<string, any>, scope: Scope): Promise<Out> {
  const cmd = byName.get(name);
  if (!cmd) throw new Error(`unknown command "${name}"`);
  if (cmd.admin && scope !== "admin") throw new Error(`"${name}" is for the user only`);
  return cmd.run(args, { scope });
}
