// The two databases (D8). core.db holds the app's internals; custom.db holds the user's
// data and is the only one agents and widgets may touch, through the guarded calls below.

import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { DATA, paths } from "./config";

// Only this user may read the data folder: it holds the password hash, tokens and your data.
mkdirSync(DATA, { recursive: true });
chmodSync(DATA, 0o700);

export const core = new Database(paths.coreDb, { create: true, strict: true });
core.exec("PRAGMA journal_mode = WAL");
core.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, created INTEGER NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT NOT NULL, created INTEGER NOT NULL, last_used INTEGER);
  CREATE TABLE IF NOT EXISTS chat (
    id INTEGER PRIMARY KEY, role TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL,
    tools TEXT, version INTEGER, error INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS versions (id INTEGER PRIMARY KEY, label TEXT NOT NULL, ts INTEGER NOT NULL, hash TEXT NOT NULL);
`);

export function getSetting(key: string): string | null {
  return core.query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? null;
}

export function setSetting(key: string, value: string) {
  core.query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
}

// ---------- custom.db ----------

let rw: Database;
let ro: Database;

function openCustom() {
  rw = new Database(paths.customDb, { create: true, strict: true });
  rw.exec("PRAGMA foreign_keys = ON");
  ro = new Database(paths.customDb, { readonly: true, strict: true });
}
openCustom();

const PRAGMAS = new Set(["table_info", "table_xinfo", "table_list", "index_list", "index_info", "foreign_key_list", "foreign_keys", "user_version"]);

/** Refuses SQL that could reach outside custom.db (D8): ATTACH, VACUUM INTO, extensions, most PRAGMAs. */
export function guard(sql: string) {
  const bare = sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .toLowerCase();
  if (/\b(attach|detach)\b/.test(bare)) throw new Error("ATTACH and DETACH aren't allowed: custom.db is the only database");
  if (/\bvacuum\s+into\b/.test(bare)) throw new Error("VACUUM INTO isn't allowed");
  if (/\bload_extension\b/.test(bare)) throw new Error("extensions aren't allowed");
  for (const m of bare.matchAll(/\bpragma\s+(?:\w+\s*\.\s*)?(\w+)/g)) {
    if (!PRAGMAS.has(m[1]!)) throw new Error(`PRAGMA ${m[1]} isn't allowed (allowed: ${[...PRAGMAS].join(", ")})`);
  }
}

type Params = unknown[] | Record<string, unknown> | undefined;

function bind(params: Params): any[] {
  if (params === undefined) return [];
  return Array.isArray(params) ? params : [params];
}

export const MAX_ROWS = 5000;

/** Read-only: runs on a read-only connection, so writes fail whatever the SQL says. */
export function query(sql: string, params?: Params): Record<string, unknown>[] {
  guard(sql);
  const rows = ro.query(sql).all(...bind(params)) as Record<string, unknown>[];
  if (rows.length > MAX_ROWS) throw new Error(`the query returned ${rows.length} rows; at most ${MAX_ROWS}. Add a LIMIT.`);
  return rows;
}

/** Writes: CREATE TABLE, INSERT, UPDATE, DELETE… Several statements are allowed without params. */
export function exec(sql: string, params?: Params): { changes: number; lastInsertRowid: number } {
  guard(sql);
  if (params === undefined) {
    const r = rw.run(sql);
    return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
  }
  const r = rw.query(sql).run(...bind(params));
  return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
}

export type TableInfo = { name: string; rows: number; columns: { name: string; type: string; notnull: boolean; pk: boolean }[] };

export function tables(): TableInfo[] {
  const names = ro.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return names.map(({ name }) => {
    const q = `"${name.replace(/"/g, '""')}"`;
    const cols = ro.query<any, []>(`PRAGMA table_info(${q})`).all();
    const { n } = ro.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${q}`).get()!;
    return { name, rows: n, columns: cols.map((c) => ({ name: c.name, type: c.type, notnull: !!c.notnull, pk: !!c.pk })) };
  });
}

/** A consistent copy of custom.db, for versions (D7). */
export function snapshotCustom(): Uint8Array {
  return rw.serialize();
}

export function restoreCustom(bytes: Uint8Array) {
  rw.close();
  ro.close();
  writeFileSync(paths.customDb, bytes);
  for (const extra of ["-journal", "-wal", "-shm"]) if (existsSync(paths.customDb + extra)) rmSync(paths.customDb + extra);
  openCustom();
}
