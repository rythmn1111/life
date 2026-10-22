# life: design notes

Living document. Decisions get a number (D1, D2, …) when they're settled; open questions stay open.
**Status:** design, nothing built yet · **Last updated:** 2026-10-23

---

## 1. The idea

A personal life dashboard that you build and run **together with your agent**.

- You don't get a fixed app with tasks, habits or budgets. You get an empty dashboard and an agent. You say "track my water intake", and the agent builds it: a table for the data, a widget to show it, commands to use it.
- You and the agent have **the same power**. Everything the UI can do, the `life` CLI can do, so an agent can drive the whole app.
- The **core** stays consistent and updatable; your **personal layer** is fully yours and can change live.

---

## 2. Vocabulary

| Word | Meaning |
| --- | --- |
| **core** | The app's own code, in this repo. Shell, command layer, CLI, component kit, widget runtime. |
| **personal layer** | Everything the agent builds for you: widgets, screens and `custom.db`. App data, not repo code (D2). |
| **widget** | One piece of the dashboard the agent wrote, built only from the component kit (D5). |
| **component kit** | The M3 building blocks the core provides: cards, lists, forms, stats, charts, data hooks. |
| **command** | One action of the app (e.g. `db.create-table`, `widget.add`). The UI and the CLI both call commands (D3). |
| **agent** | The AI you chat with in the dashboard. Runs on the VPS in an agentpod pod (D10). |

---

## 3. The picture

```
 you (browser) ──▶ web UI ──┐
                            ├──▶ command layer (core) ──┬──▶ core.db    app internals: chat, widget registry, versions, settings
 agent / you ──▶ life CLI ──┘          │                └──▶ custom.db  your life data, tables the agent creates
                                       │
                                       └──▶ personal layer folder: widget code, versioned (D7)

 chat panel ──▶ agent (agentpod pod on the VPS)
                  rw: personal layer · ro: core code · drives everything through the life CLI
```

On disk:

| | Local | VPS |
| --- | --- | --- |
| Core code (git) | `/Volumes/rythmn103/code/life` | `/opt/life` |
| Data: `core.db`, `custom.db`, personal layer | `./data/` (ignored by git) | `/var/lib/life/` |

The data folder is set by `LIFE_DATA`. Local and VPS data are separate and never synced.

---

## 4. Decided so far

| # | Decision | When |
| --- | --- | --- |
| D1 | **Core changes go local → GitHub → VPS**, never directly on the VPS (CLAUDE.md). | 2026-10-22 |
| D2 | **The personal layer is app data.** Changed live on the VPS through the app, never committed, backed up instead. If a customization needs something the core can't do, that's a core change and follows D1. | 2026-10-23 |
| D3 | **Two ways in, equal power:** the `life` CLI and the web UI, both on top of one command layer. A feature isn't done until the CLI can do it. | 2026-10-22 |
| D4 | **The core ships no life features.** It's a platform: shell, chat, component kit, widget runtime, CLI. Tasks, habits, money… are all built by the agent on request. | 2026-10-23 |
| D5 | **Widgets use only the component kit** (Material 3 tokens and components). That's what keeps agent-built screens consistent. | 2026-10-23 |
| D6 | **A broken widget can't break the app.** Each widget is isolated and shows an error card if it fails. Safe mode loads the core only. | 2026-10-23 |
| D7 | **Every change to the personal layer is a version.** `life undo` rolls back; history is kept. | 2026-10-23 |
| D8 | **Two SQLite databases.** `core.db` holds app internals; `custom.db` holds your data and is the only one the agent may create tables in. Agent-written code never touches `core.db`. | 2026-10-23 |
| D9 | **Stack:** TypeScript on Bun, SQLite (`bun:sqlite`), a web UI on Material 3 tokens. Runs under pm2 on the VPS. | 2026-10-23 |
| D10 | **The agent lives in a chat panel in the dashboard.** It runs on the VPS in an agentpod pod, with your Claude subscription: read-write on the personal layer, read-only on the core code. | 2026-10-23 |
| D11 | **Access, for now: the VPS IP, port 8810, plain HTTP, with a login.** HTTPS (Tailscale or a domain) comes later and needs no app changes. | 2026-10-23 |
| D12 | **Single user.** Personal project; no accounts beyond yours. | 2026-10-23 |

---

## 5. Open questions

- **Q1. Widget format.** What exactly a widget is (a TSX module, an HTML fragment, a declarative spec), and how it's isolated in the browser (iframe or in-page error boundary). Decides how much freedom the agent has and how D6 is enforced.
- **Q2. How widgets read and write data.** Through commands only, or raw SQL on `custom.db`? Leaning: a small data hook in the component kit that calls commands.
- **Q3. Remote CLI.** How `life` authenticates when used from the laptop against the VPS (a token).
- **Q4. The agent on the VPS.** agentpod hasn't run there with real logins yet, and the VPS runs everything as `root`. Verify before relying on it.
- **Q5. Agent memory.** One long conversation, or new sessions with a summary of what's been built?
- **Q6. Automations.** The agent acting on its own: reminders, a morning brief, weekly reviews. Later.
- **Q7. Backups.** Where and how often the data folder is copied.
- **Q8. HTTPS.** Tailscale (free, your devices only) or a domain on Cloudflare (~$10/year, any browser). Until then, avoid public Wi-Fi: the login and data travel unencrypted.

---

## 6. v1 (first build, local first)

1. The shell: M3 web app, login, empty dashboard, chat panel.
2. The command layer, its HTTP API, and the `life` CLI on the same commands.
3. `custom.db` with `life db` commands (create tables, insert, query).
4. The widget runtime and a small component kit: card, list, form, stat, chart.
5. Versions, `life undo` and safe mode.
6. The agent in the chat panel through agentpod: on the Mac first, then on the VPS.
7. Deploy to the VPS under pm2, following D1.

---

## Changelog
- **2026-10-22:** Project created; deployment rule (D1); two ways in (D3).
- **2026-10-23:** Core vs personal layer (D2, D4–D8); stack (D9); agent in a dashboard chat on the VPS (D10); access by IP for now (D11); single user (D12). This document started.
