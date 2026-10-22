// The personal layer (D2): widget code, layout and theme, edited live by the agent.
// Widgets compile here, may import only react, @life/kit and their own files (D5), and
// every agent turn is a version that `life undo` can roll back (D7).

import type { BunPlugin } from "bun";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { paths } from "./config";
import { core, restoreCustom, snapshotCustom } from "./db";
import { broadcast } from "./events";

export const VARIANTS = ["tonal_spot", "expressive", "vibrant", "neutral", "fidelity", "content", "monochrome", "rainbow", "fruit_salad"] as const;
export type Variant = (typeof VARIANTS)[number];
export type Theme = { seed: string; variant: Variant; mode: "auto" | "light" | "dark" };
export type WidgetEntry = { id: string; title: string; span: 1 | 2 | 3 };
export type Layout = { widgets: WidgetEntry[] };

export const ID = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const DEFAULT_THEME: Theme = { seed: "#6750A4", variant: "tonal_spot", mode: "auto" };

mkdirSync(paths.widgets, { recursive: true });
mkdirSync(paths.versions, { recursive: true });
if (!existsSync(paths.layout)) writeFileSync(paths.layout, JSON.stringify({ widgets: [] }, null, 2) + "\n");
if (!existsSync(paths.theme)) writeFileSync(paths.theme, JSON.stringify(DEFAULT_THEME, null, 2) + "\n");

// ---------- layout and theme ----------

export function readLayout(): Layout {
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(paths.layout, "utf8"));
  } catch (e) {
    throw new Error(`layer/layout.json isn't valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(raw?.widgets)) throw new Error('layer/layout.json needs { "widgets": [...] }');
  return {
    widgets: raw.widgets.map((w: any, i: number) => {
      if (typeof w?.id !== "string" || !ID.test(w.id)) throw new Error(`layout.json widget ${i}: "id" must match ${ID}`);
      const span = [1, 2, 3].includes(w.span) ? w.span : 1;
      return { id: w.id, title: typeof w.title === "string" ? w.title : w.id, span };
    }),
  };
}

export function writeLayout(l: Layout) {
  writeFileSync(paths.layout, JSON.stringify(l, null, 2) + "\n");
  broadcast({ type: "layer" });
}

export function readTheme(): Theme {
  try {
    const t = JSON.parse(readFileSync(paths.theme, "utf8"));
    return {
      seed: /^#[0-9a-fA-F]{6}$/.test(t.seed) ? t.seed : DEFAULT_THEME.seed,
      variant: VARIANTS.includes(t.variant) ? t.variant : DEFAULT_THEME.variant,
      mode: ["auto", "light", "dark"].includes(t.mode) ? t.mode : DEFAULT_THEME.mode,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export function writeTheme(t: Theme) {
  writeFileSync(paths.theme, JSON.stringify(t, null, 2) + "\n");
  broadcast({ type: "theme" });
}

export function widgetFile(id: string): string {
  return join(paths.widgets, `${id}.tsx`);
}

export const STARTER = `import { Text } from "@life/kit";

export default function Widget() {
  return <Text>New widget</Text>;
}
`;

// ---------- compiling widgets ----------

/** Provided by the dashboard at runtime (src/web/main.tsx), never bundled into widgets. */
const GLOBALS = new Set(["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "@life/kit"]);
const TRIES = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"];

/** A widget's own import, resolved without leaving the widgets folder (no ../, no symlinks out). */
function resolveInside(importer: string, spec: string): string {
  const root = realpathSync(paths.widgets);
  const base = resolve(dirname(importer), spec);
  for (const t of TRIES) {
    if (!existsSync(base + t)) continue;
    const real = realpathSync(base + t);
    if (!statSync(real).isFile()) continue;
    if (!real.startsWith(root + sep)) throw new Error(`"${spec}" is outside the widgets folder`);
    if (!/\.(tsx|ts|jsx|js|json)$/.test(real)) throw new Error(`"${spec}": widgets may import only .tsx, .ts, .jsx, .js and .json files`);
    return real;
  }
  throw new Error(`can't find "${spec}"`);
}

const widgetPlugin: BunPlugin = {
  name: "life-widget",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (GLOBALS.has(args.path)) return { path: args.path, namespace: "life-global" };
      if (!args.importer) return; // the entry point, checked before building
      if (!args.path.startsWith(".")) {
        throw new Error(`widgets can import only react, @life/kit and their own files, not "${args.path}"`);
      }
      return { path: resolveInside(args.importer, args.path) };
    });
    b.onLoad({ filter: /.*/, namespace: "life-global" }, (args) => ({
      contents: `module.exports = globalThis.__life[${JSON.stringify(args.path)}];`,
      loader: "js",
    }));
  },
};

export type Compiled = { code: string } | { error: string };
const cache = new Map<string, { key: string; out: Compiled }>();

/** Changes whenever any file in the widgets folder does. */
function fingerprint(): string {
  return readdirSync(paths.widgets, { recursive: true })
    .map(String)
    .sort()
    .map((f) => {
      const s = lstatSync(join(paths.widgets, f));
      return `${f}:${s.mtimeMs}:${s.size}`;
    })
    .join("|");
}

function formatLogs(logs: any[]): string {
  return logs
    .map((l) => {
      const p = l.position;
      const where = p?.file ? `${p.file.replace(paths.layer + sep, "")}:${p.line}:${p.column}: ` : "";
      return `${where}${l.message ?? String(l)}${p?.lineText ? `\n    ${p.lineText.trim()}` : ""}`;
    })
    .join("\n");
}

export async function compileWidget(id: string): Promise<Compiled> {
  if (!ID.test(id)) return { error: `bad widget id "${id}"` };
  const file = widgetFile(id);
  if (!existsSync(file)) return { error: `layer/widgets/${id}.tsx doesn't exist` };
  const key = fingerprint();
  const hit = cache.get(id);
  if (hit?.key === key) return hit.out;
  let out: Compiled;
  try {
    const entry = realpathSync(file);
    if (!entry.startsWith(realpathSync(paths.widgets) + sep)) throw new Error(`widgets/${id}.tsx points outside the widgets folder`);
    const r = await Bun.build({
      entrypoints: [entry],
      root: realpathSync(paths.widgets),
      target: "browser",
      format: "esm",
      jsx: { runtime: "automatic", importSource: "react", development: false },
      plugins: [widgetPlugin],
      throw: false,
    });
    // Bun marks each source file with a "// <path>" comment; drop them so no server paths reach the browser.
    out = r.success
      ? { code: (await r.outputs[0]!.text()).replace(/^\/\/ \S+\.(tsx|ts|jsx|js|json)$/gm, "") }
      : { error: formatLogs(r.logs) || "build failed" };
  } catch (e: any) {
    out = { error: e?.errors ? formatLogs(e.errors) : e?.message ?? String(e) };
  }
  cache.set(id, { key, out });
  return out;
}

// ---------- live reload ----------

export function watchLayer() {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    watch(paths.layer, { recursive: true }, (_, file) => {
      clearTimeout(t);
      t = setTimeout(() => broadcast({ type: String(file).endsWith("theme.json") ? "theme" : "layer" }), 150);
    });
  } catch (e) {
    console.warn(`life: can't watch the personal layer (${(e as Error).message}); dashboards refresh after each agent turn instead`);
  }
}

// ---------- versions (D7) ----------

export type Version = { id: number; label: string; ts: number; hash: string };

/** A hash of the whole personal layer plus custom.db, to tell whether anything changed. */
export function stateHash(): string {
  const h = new Bun.CryptoHasher("sha256");
  for (const f of readdirSync(paths.layer, { recursive: true }).map(String).sort()) {
    const p = join(paths.layer, f);
    const s = lstatSync(p);
    if (s.isSymbolicLink()) h.update(`${f}->${readlinkSync(p)}\n`);
    else if (s.isFile()) h.update(f + "\n").update(readFileSync(p));
  }
  h.update(snapshotCustom());
  return h.digest("hex");
}

const KEEP = 50;

export function snapshot(label: string, hash = stateHash()): number {
  const id = Number(core.query("INSERT INTO versions (label, ts, hash) VALUES (?, ?, ?)").run(label.slice(0, 200), Date.now(), hash).lastInsertRowid);
  const dir = join(paths.versions, String(id));
  cpSync(paths.layer, join(dir, "layer"), { recursive: true, verbatimSymlinks: true });
  writeFileSync(join(dir, "custom.db"), snapshotCustom());
  for (const old of core.query<{ id: number }, [number]>("SELECT id FROM versions ORDER BY id DESC LIMIT -1 OFFSET ?").all(KEEP)) dropVersion(old.id);
  return id;
}

export function dropVersion(id: number) {
  core.query("DELETE FROM versions WHERE id = ?").run(id);
  rmSync(join(paths.versions, String(id)), { recursive: true, force: true });
}

export function versions(): Version[] {
  return core.query<Version, []>("SELECT id, label, ts, hash FROM versions ORDER BY id DESC").all();
}

/** Puts the layer (and with `withData`, custom.db) back as it was in version `id`. */
export function restore(id: number, withData: boolean) {
  const dir = join(paths.versions, String(id));
  if (!existsSync(dir)) throw new Error(`there's no version ${id}`);
  // Empty the layer folder in place (it's being watched), then copy the version back.
  for (const f of readdirSync(paths.layer)) rmSync(join(paths.layer, f), { recursive: true, force: true });
  cpSync(join(dir, "layer"), paths.layer, { recursive: true, verbatimSymlinks: true });
  mkdirSync(paths.widgets, { recursive: true });
  if (withData) {
    restoreCustom(readFileSync(join(dir, "custom.db")));
    broadcast({ type: "data" });
  }
  broadcast({ type: "layer" });
  broadcast({ type: "theme" });
}

/** Rolls back to the newest version and removes it, so repeated undos walk back in time. */
export function undo(withData: boolean): Version {
  const v = versions()[0];
  if (!v) throw new Error("nothing to undo");
  restore(v.id, withData);
  dropVersion(v.id);
  return v;
}
