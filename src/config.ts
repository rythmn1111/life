// Where everything lives. The code is the repo (core, D1); everything under DATA is app
// data (the personal layer and server-only state, D2), set by LIFE_DATA.

import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "..");
export const DATA = resolve(process.env.LIFE_DATA ?? join(ROOT, "data"));
export const PORT = Number(process.env.LIFE_PORT ?? 8810);
/** 127.0.0.1 locally; the VPS sets 0.0.0.0 so it's reachable by IP (D11). */
export const HOST = process.env.LIFE_HOST ?? "127.0.0.1";
/** The model the agent pod runs (D10). */
export const MODEL = process.env.LIFE_MODEL ?? "claude-opus-5-5";
export const APP = { id: "com.rythmn.life", name: "Life" };

export const paths = {
  coreDb: join(DATA, "core.db"),
  customDb: join(DATA, "custom.db"),
  /** The personal layer the agent edits: widgets, layout, theme. */
  layer: join(DATA, "layer"),
  widgets: join(DATA, "layer", "widgets"),
  layout: join(DATA, "layer", "layout.json"),
  theme: join(DATA, "layer", "theme.json"),
  versions: join(DATA, "versions"),
  /** The agentpod project: apod.toml and apods.md, generated at startup. */
  agent: join(DATA, "agent"),
  /** What the pod may read: the `life` wrapper and the agent's token. */
  agentCli: join(DATA, "agent", "cli"),
  /** The CLI's token on this machine, written by the server at startup. */
  localCli: join(DATA, "cli.json"),
  src: join(ROOT, "src"),
  docs: join(ROOT, "docs"),
};
