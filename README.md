# Life

A personal life dashboard you build with your agent. It ships with **no features**: you tell the agent what you want to track ("my water intake", "a habits checklist", "spending by category") and it builds the widget, the table for the data, and puts it on your dashboard. Everything works from the web UI and from the `life` CLI.

The why and every decision are in [DESIGN.md](DESIGN.md). The rules for working on this repo are in [CLAUDE.md](CLAUDE.md). What the agent is told is in [docs/agent.md](docs/agent.md).

## Run it locally

Needs [Bun](https://bun.sh) and, for the agent, [agentpod](https://github.com/rythmn1111/agentpod) (`apod`) with Claude logged in (`apod login claude`).

```sh
bun install
bun src/cli.ts passwd                              # set the dashboard password
apod apps approve com.rythmn.life --name Life      # once: lets Life use agentpod (an agent adds --yes)
bun src/server.ts                                  # http://127.0.0.1:8810
```

`bun link` puts `life` on your PATH, so `bun src/cli.ts …` becomes `life …`.

## The CLI

```sh
life help                                   # every command
life status
life chat send "track how much water I drink"   # talk to the agent; it streams what it does
life widget list | add | set | move | remove | check
life db tables | query "SELECT …" | exec "…"
life theme set --seed "#2E7D32" --variant expressive
life version list | save | restore <id>
life undo                                   # roll back the last change (repeat to go further)
```

On the server's machine the CLI finds the server by itself. From another machine: run `life token create laptop` on the server, then the `life remote …` line it prints on the laptop.

## How it fits together

| | Where | In git? |
| --- | --- | --- |
| **Core:** server, commands, CLI, UI shell, component kit (`src/`) | this repo | yes, and it changes only through local → GitHub → VPS |
| **Personal layer:** widgets, layout, theme (`<data>/layer/`) | `./data` locally, `/var/lib/life` on the VPS | no, it's app data the agent changes live |
| **Your data:** `custom.db`, tables the agent creates | same data folder | no |
| **App internals:** `core.db` (password, sessions, chat, versions) | same data folder | no |

- The **agent** is one Claude pod (Opus 5.5) in agentpod. It can write only the personal layer, read the core code, and use the `life` CLI with its own token. Its project (`apod.toml`, `apods.md`) is generated in `<data>/agent/` at startup.
- **Widgets** are `.tsx` files built only from `@life/kit` (Material 3 Expressive components). The server compiles them; the dashboard loads each one in isolation, so a broken widget shows an error card. `/?safe` loads none.
- **Every agent turn is a version.** "Undo these changes" in the chat, or `life undo`, rolls it back.

Settings: `LIFE_DATA` (data folder), `LIFE_HOST` and `LIFE_PORT` (default `127.0.0.1:8810`), `LIFE_MODEL` (default `claude-opus-5-5`), `LIFE_DEV=1` (rebuild the UI when `src/web` changes).

## The Mac app

`desktop/` is Life for macOS (Electron): a native window onto your Life server. The UI comes from the server, so updates to the core reach the app without rebuilding it. It adds what a browser tab can't:

- **⌘⇧L from anywhere** opens Life with the agent's chat ready to type;
- a **menu bar icon**: open Life, ask the agent, see if it's working, change server, launch at login, quit;
- **notifications** when the agent finishes while Life isn't in front, and `notify()` for widgets (reminders work while the app runs in the menu bar);
- closing the window keeps Life in the menu bar; ⌘Q quits.

```sh
cd desktop && bun install && bun run build      # → desktop/out/Life-darwin-arm64/Life.app
```

Drag `Life.app` to Applications. On first launch it asks for the server: `http://<your VPS IP>:8810`, or `http://127.0.0.1:8810` for a local one (change it later from the menu bar). `bun run dev` runs it without packaging. The icons come from `bun scripts/icons.ts` (needs Google Chrome). The app is built on your Mac from this repo; it's never deployed to the VPS.

## Deploy (VPS)

Always: test locally, commit and push, then on the VPS (`,server`):

```sh
cd /opt/life && git pull && bun install && pm2 startOrReload ecosystem.config.cjs --only life --update-env
```

## Tests

```sh
bun test          # SQL guard, CLI parsing, widget import rules, versions
bun check         # types
```
