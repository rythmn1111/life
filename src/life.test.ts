// Tests use a throwaway data folder, never ./data.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "life-test-"));
process.env.LIFE_DATA = dir;
const { exec, guard, query } = await import("./db");
const { parse, run } = await import("./commands");
const { compileWidget, widgetFile } = await import("./layer");
const { paths } = await import("./config");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("custom.db guard (D8)", () => {
  test("refuses ways out of custom.db", () => {
    expect(() => guard(`ATTACH '${dir}/core.db' AS c`)).toThrow(/ATTACH/);
    expect(() => guard("attach database 'x' as y")).toThrow(/ATTACH/);
    expect(() => guard("VACUUM INTO '/tmp/x.db'")).toThrow(/VACUUM INTO/);
    expect(() => guard("SELECT load_extension('x')")).toThrow(/extensions/);
    expect(() => guard("PRAGMA journal_mode = OFF")).toThrow(/journal_mode/);
    expect(() => guard("PRAGMA main.writable_schema = 1")).toThrow(/writable_schema/);
  });
  test("allows normal SQL, and words like attach inside strings", () => {
    expect(() => guard("SELECT * FROM notes WHERE body = 'please attach the file'")).not.toThrow();
    expect(() => guard("PRAGMA table_info(notes)")).not.toThrow();
  });
  test("query is read-only whatever the SQL says", () => {
    exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    exec("INSERT INTO t (v) VALUES (?)", ["a"]);
    expect(query("SELECT v FROM t")).toEqual([{ v: "a" }]);
    expect(() => query("INSERT INTO t (v) VALUES ('b')")).toThrow(/readonly/);
  });
});

describe("CLI parsing (D3)", () => {
  test("finds multi-word commands, args and flags", () => {
    const p = parse(["db", "query", "SELECT 1", "--params", "[1]"]);
    expect("cmd" in p && p.cmd.name).toBe("db.query");
    expect("cmd" in p && p.args).toEqual({ sql: "SELECT 1", params: "[1]" });
    const w = parse(["widget", "add", "water", "--title=Water", "--span", "2"]);
    expect("cmd" in w && w.args).toEqual({ id: "water", title: "Water", span: 2 });
  });
  test("joins the rest of the words for messages", () => {
    const p = parse(["chat", "send", "track", "my", "water"]);
    expect("cmd" in p && p.args.message).toBe("track my water");
  });
  test("explains mistakes", () => {
    expect(parse(["db", "query"])).toMatchObject({ fail: true, text: expect.stringContaining("missing <sql>") });
    expect(parse(["widget", "add", "x", "--colour", "red"])).toMatchObject({ fail: true, text: expect.stringContaining("unknown flag") });
    expect(parse(["nope"])).toMatchObject({ fail: true });
  });
  test("the agent can't use the user's commands", async () => {
    await expect(run("chat.send", { message: "hi" }, "agent")).rejects.toThrow(/user only/);
  });
});

describe("widgets (D5, D6)", () => {
  test("compile with react and @life/kit left to the dashboard", async () => {
    writeFileSync(widgetFile("ok"), `import { useState } from "react";\nimport { Text } from "@life/kit";\nexport default function W() { const [n] = useState(1); return <Text>{n}</Text>; }\n`);
    const r = await compileWidget("ok");
    expect("code" in r && r.code).toContain('globalThis.__life["@life/kit"]');
    expect("code" in r && r.code).not.toContain(dir);
  });
  test("can't import packages, or files outside the widgets folder", async () => {
    writeFileSync(widgetFile("npm"), `import _ from "lodash";\nexport default () => _.x;\n`);
    expect(await compileWidget("npm")).toMatchObject({ error: expect.stringContaining('not "lodash"') });
    writeFileSync(widgetFile("up"), `import x from "../../core.db";\nexport default () => x;\n`);
    expect(await compileWidget("up")).toMatchObject({ error: expect.stringContaining("outside the widgets folder") });
    mkdirSync(join(paths.widgets, "lib"), { recursive: true });
    symlinkSync(paths.coreDb, join(paths.widgets, "lib", "link.ts"));
    writeFileSync(widgetFile("sym"), `import x from "./lib/link";\nexport default () => x;\n`);
    expect(await compileWidget("sym")).toMatchObject({ error: expect.stringContaining("outside the widgets folder") });
  });
  test("report syntax errors with the line", async () => {
    writeFileSync(widgetFile("bad"), `export default function W() {\n  return <div>\n}\n`);
    expect(await compileWidget("bad")).toMatchObject({ error: expect.stringContaining("widgets/bad.tsx:") });
  });
});

describe("versions (D7)", () => {
  test("undo brings back the layer, and with --with-data the data too", async () => {
    await run("widget.add", { id: "ok", title: "One" }, "admin");
    await run("version.save", { label: "one" }, "admin");
    exec("INSERT INTO t (v) VALUES ('after')");
    await run("widget.set", { id: "ok", title: "Two" }, "admin");
    await run("undo", {}, "admin");
    expect(JSON.parse(readFileSync(paths.layout, "utf8")).widgets[0].title).toBe("One");
    expect(query("SELECT count(*) AS n FROM t")[0]!.n).toBe(2);
    await run("version.save", { label: "two" }, "admin");
    exec("DELETE FROM t");
    await run("undo", { "with-data": true }, "admin");
    expect(query("SELECT count(*) AS n FROM t")[0]!.n).toBe(2);
  });
});
