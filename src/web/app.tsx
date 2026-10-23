// The shell (D4): sign in, the dashboard of agent-built widgets, and the chat with the agent.
// Widgets are isolated (D6): a broken one shows an error card, and ?safe loads none.

import { Component, type ComponentType, type ErrorInfo, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { type LifeEvent, cmd, onLife } from "./api";
import { desktop } from "./desktop";
import { Button, Chip, Icon, IconButton, Loading, Text, TextField } from "./kit";
import { DEFAULT_THEME, type Theme, applyTheme } from "./theme";

type WidgetEntry = { id: string; title: string; span: 1 | 2 | 3 };
type ChatMessage = { id: number; role: "user" | "agent"; text: string; ts: number; tools: string[]; version: number | null; error: boolean };

function useLife(fn: (e: LifeEvent) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => onLife((e) => ref.current(e)), []);
}

function useMedia(q: string): boolean {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

// ---------- snackbar ----------

let showSnack: (text: string) => void = () => {};
export const snack = (text: string) => showSnack(text);

function Snackbar() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    showSnack = (s) => {
      setText(s);
      clearTimeout(t);
      t = setTimeout(() => setText(null), 4000);
    };
  }, []);
  return text ? <div className="snackbar" role="status">{text}</div> : null;
}

// ---------- app ----------

export function App() {
  const [me, setMe] = useState<{ authed: boolean; hasPassword: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then(setMe, () => setMe({ authed: false, hasPassword: true }));
  }, []);
  if (!me) return <div className="signin"><Loading /></div>;
  if (!me.authed) return <SignIn hasPassword={me.hasPassword} />;
  return (
    <>
      <Shell />
      <Snackbar />
    </>
  );
}

function SignIn({ hasPassword }: { hasPassword: boolean }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) });
    if (r.ok) location.reload();
    else {
      setError((await r.json()).error);
      setBusy(false);
    }
  }
  return (
    <div className="signin">
      <form onSubmit={submit}>
        <span className="mark"><Icon name="spa" size={32} fill /></span>
        <Text variant="headline-small" style={{ textAlign: "center" }}>Life</Text>
        {hasPassword ? (
          <>
            <TextField label="Password" type="password" value={pw} onChange={setPw} error={error} autoFocus />
            <Button type="submit" size="m" disabled={busy || !pw}>Sign in</Button>
          </>
        ) : (
          <Text variant="body-medium" color="on-surface-variant" style={{ textAlign: "center" }}>
            No password yet. On the server, run <code>life passwd</code>, then reload this page.
          </Text>
        )}
      </form>
    </div>
  );
}

function Shell() {
  const wide = useMedia("(min-width: 1000px)");
  const [chatOpen, setChatOpen] = useState(wide);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [focusChat, setFocusChat] = useState(0);
  const safe = useMemo(() => new URLSearchParams(location.search).has("safe"), []);

  useEffect(() => {
    const load = () => cmd<Theme>("theme.get").then(applyTheme, () => applyTheme(DEFAULT_THEME));
    const working = (b: boolean) => {
      setBusy(b);
      desktop?.setBusy(b);
    };
    load();
    cmd("agent.status").then((s) => working(s.busy), () => {});
    // In the Mac app: the global shortcut opens the chat, ready to type.
    desktop?.onOpenChat(() => {
      setChatOpen(true);
      setFocusChat((n) => n + 1);
    });
    return onLife((e) => {
      if (e.type === "theme") load();
      if (e.type === "turn") working(e.state === "start");
      // The agent answered while Life wasn't in front: tell the user.
      if (e.type === "chat" && e.message?.role === "agent" && !document.hasFocus()) {
        desktop?.notify(e.message.error ? "The agent hit a problem" : "The agent is done", firstLine(e.message.text));
      }
    });
  }, []);

  const ask = (text: string) => {
    setDraft(text);
    setChatOpen(true);
  };

  return (
    <div className={chatOpen ? "shell chat-open" : "shell"}>
      <main className="main">
        <TopBar chatOpen={chatOpen} onChat={() => setChatOpen((o) => !o)} safe={safe} />
        {safe && (
          <div className="safe-banner">
            <Icon name="shield" />
            <Text variant="body-medium" style={{ flex: 1 }}>Safe mode: widgets aren't loaded.</Text>
            <Button variant="text" onClick={() => (location.href = "/")}>Leave</Button>
          </div>
        )}
        <Dashboard safe={safe} onAsk={ask} />
      </main>
      {chatOpen && <Chat draft={draft} setDraft={setDraft} focus={focusChat} onClose={() => setChatOpen(false)} />}
      {!chatOpen && (
        <button className="fab" onClick={() => setChatOpen(true)}>
          <Icon name="auto_awesome" fill />
          {busy ? "Working" : "Ask"}
          {busy && <span className="dot" />}
        </button>
      )}
    </div>
  );
}

function TopBar({ chatOpen, onChat, safe }: { chatOpen: boolean; onChat: () => void; safe: boolean }) {
  const [menu, setMenu] = useState(false);
  const [mode, setMode] = useState<Theme["mode"]>("auto");
  useEffect(() => {
    cmd<Theme>("theme.get").then((t) => setMode(t.mode), () => {});
  }, []);
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const nextMode = ({ auto: "light", light: "dark", dark: "auto" } as const)[mode];
  const run = async (name: string, args = {}) => {
    setMenu(false);
    try {
      const r = await cmd(name, args);
      snack(name === "undo" ? `Rolled back to "${r.label.replace(/^before: /, "before ")}"` : "Done");
    } catch (e) {
      snack((e as Error).message);
    }
  };
  return (
    <header className="topbar">
      <div className="titles">
        <Text variant="title-large" as="h2" style={{ margin: 0 }}>Life</Text>
        <div className="date t-body-small">{date}</div>
      </div>
      <IconButton
        icon={{ auto: "brightness_auto", light: "light_mode", dark: "dark_mode" }[mode]}
        label={`Theme: ${mode} (switch to ${nextMode})`}
        onClick={() => {
          setMode(nextMode);
          cmd("theme.set", { mode: nextMode }).catch((e) => snack(e.message));
        }}
      />
      <IconButton icon="forum" label={chatOpen ? "Close the agent" : "Open the agent"} selected={chatOpen} onClick={onChat} />
      <div className="menu-anchor">
        <IconButton icon="more_vert" label="More" onClick={() => setMenu((m) => !m)} />
        {menu && (
          <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
            <button role="menuitem" onClick={() => run("undo")}><Icon name="undo" />Undo the last change</button>
            <button role="menuitem" onClick={() => (location.href = safe ? "/" : "/?safe")}><Icon name="shield" />{safe ? "Leave safe mode" : "Safe mode"}</button>
            <button role="menuitem" onClick={() => fetch("/api/logout", { method: "POST" }).then(() => location.reload())}><Icon name="logout" />Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}

// ---------- the dashboard ----------

function Dashboard({ safe, onAsk }: { safe: boolean; onAsk: (text: string) => void }) {
  const [widgets, setWidgets] = useState<WidgetEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  const load = () =>
    cmd<{ layout: { widgets: WidgetEntry[] } }>("widget.list").then(
      (d) => {
        setWidgets(d.layout.widgets);
        setError(null);
      },
      (e) => setError(e.message),
    );
  useEffect(() => {
    load();
  }, []);
  useLife((e) => {
    if (e.type === "layer") {
      setGen((g) => g + 1);
      load();
    }
  });

  if (error)
    return (
      <div className="widget-error">
        <Text variant="title-small">The dashboard's layout is broken</Text>
        <pre>{error}</pre>
        <div><Button variant="tonal" icon="auto_awesome" onClick={() => onAsk(`The dashboard says: ${error}\nPlease fix it.`)}>Ask the agent to fix it</Button></div>
      </div>
    );
  if (!widgets) return <div className="widget-loading"><Loading /></div>;
  if (!widgets.length) return <EmptyDashboard onAsk={onAsk} />;
  return (
    <div className="dashboard">
      <div className="grid">
        {widgets.map((w) => (
          <section key={w.id} className={`widget span-${w.span}`} aria-label={w.title}>
            <header>
              <Text variant="title-medium" as="h2">{w.title}</Text>
            </header>
            {safe ? (
              <Text variant="body-medium" color="on-surface-variant">Not loaded in safe mode.</Text>
            ) : (
              <WidgetHost key={`${w.id}:${gen}`} id={w.id} title={w.title} gen={gen} onAsk={onAsk} />
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

const SUGGESTIONS = ["Track how much water I drink", "A daily habits checklist", "Log my spending by category", "A journal with my mood"];

function EmptyDashboard({ onAsk }: { onAsk: (text: string) => void }) {
  return (
    <div className="empty-dashboard">
      <div className="art"><Icon name="dashboard_customize" size={48} /></div>
      <Text variant="headline-small">Your dashboard is empty</Text>
      <Text variant="body-large" color="on-surface-variant">Tell your agent what you want to keep track of, and it builds it for you, right here.</Text>
      <div className="suggestions">
        {SUGGESTIONS.map((s) => <Chip key={s} label={s} icon="auto_awesome" onClick={() => onAsk(s)} />)}
      </div>
    </div>
  );
}

function WidgetProblem({ title, error, onAsk }: { title: string; error: string; onAsk: (text: string) => void }) {
  return (
    <div className="widget-error">
      <Text variant="title-small">This widget has a problem</Text>
      <pre>{error}</pre>
      <div>
        <Button variant="tonal" size="xs" icon="auto_awesome" onClick={() => onAsk(`The "${title}" widget shows this error:\n${error}\nPlease fix it.`)}>
          Ask the agent to fix it
        </Button>
      </div>
    </div>
  );
}

class Boundary extends Component<{ children: ReactNode; fallback: (error: string) => ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  componentDidCatch(e: unknown, info: ErrorInfo) {
    console.error(e, info.componentStack);
  }
  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

/** Loads one widget's compiled code as a module and renders its default export. */
function WidgetHost({ id, title, gen, onAsk }: { id: string; title: string; gen: number; onAsk: (text: string) => void }) {
  const [state, setState] = useState<{ C?: ComponentType; error?: string }>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch(`/api/widget/${encodeURIComponent(id)}`).then((x) => x.json());
      if (r.error) return alive && setState({ error: r.error });
      const url = URL.createObjectURL(new Blob([r.code], { type: "text/javascript" }));
      try {
        const m = await import(/* @vite-ignore */ url);
        if (typeof m.default !== "function") throw new Error("the widget must `export default` a React component");
        if (alive) setState({ C: m.default });
      } catch (e) {
        if (alive) setState({ error: (e as Error).message });
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, gen]);
  if (state.error) return <WidgetProblem title={title} error={state.error} onAsk={onAsk} />;
  if (!state.C) return <div className="widget-loading"><Loading size={36} /></div>;
  const C = state.C;
  return (
    <Boundary fallback={(error) => <WidgetProblem title={title} error={error} onAsk={onAsk} />}>
      <C />
    </Boundary>
  );
}

// ---------- the chat ----------

function Chat({ draft, setDraft, focus, onClose }: { draft: string; setDraft: (s: string) => void; focus: number; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<string[]>([]);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const load = () => cmd<ChatMessage[]>("chat.history", { limit: 100 }).then(setMessages, () => {});
  useEffect(() => {
    load();
    cmd("agent.status").then((s) => setBusy(s.busy), () => {});
  }, []);
  useLife((e) => {
    if (e.type === "chat") {
      if (!e.message) load();
      else setMessages((m) => (m.some((x) => x.id === e.message.id) ? m : [...m, e.message]));
    }
    if (e.type === "turn") {
      setBusy(e.state === "start");
      setLive([]);
    }
    if (e.type === "agent" && e.kind === "tool") setLive((l) => [...l, e.text]);
  });
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, live.length, busy]);
  useEffect(() => {
    const t = input.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
    if (draft) t.focus();
  }, [draft]);
  useEffect(() => {
    if (focus) input.current?.focus();
  }, [focus]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    try {
      await cmd("chat.send", { message: text });
    } catch (e) {
      snack((e as Error).message);
      setDraft(text);
    }
  }

  async function undoTurn(m: ChatMessage) {
    try {
      await cmd("version.restore", { id: m.version });
      snack("Changes undone. Undo again from the menu to bring them back.");
    } catch (e) {
      snack((e as Error).message);
    }
  }

  return (
    <aside className="chat" aria-label="Agent">
      <header>
        <div className="titles">
          <Text variant="title-large">Agent</Text>
          <Text variant="body-small" color="on-surface-variant">{busy ? "Working…" : "Builds and changes your dashboard"}</Text>
        </div>
        <IconButton icon="close" label="Close" onClick={onClose} />
      </header>
      <div className="log" ref={log}>
        {!messages.length && !busy && (
          <div className="hello">
            <Icon name="auto_awesome" size={36} color="primary" fill />
            <Text variant="title-medium">What should your dashboard do?</Text>
            <Text variant="body-medium" color="on-surface-variant">
              Ask for anything: trackers, lists, charts, a new look. The agent builds it and you can undo any change.
            </Text>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}${m.error ? " error" : ""}`}>
            <Markdown text={m.text} />
            {m.tools.length > 0 && (
              <details className="steps">
                <summary><Icon name="build" size={14} />{m.tools.length} step{m.tools.length === 1 ? "" : "s"}</summary>
                <ul>{m.tools.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </details>
            )}
            {m.version !== null && (
              <div className="msg-actions">
                <Button variant="text" size="xs" icon="undo" onClick={() => undoTurn(m)}>Undo these changes</Button>
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="live">
            <Loading size={32} />
            <div style={{ minWidth: 0 }}>
              <Text variant="label-large">Working on it</Text>
              {live.length > 0 && <Text variant="body-small" color="on-surface-variant">{live[live.length - 1]}</Text>}
            </div>
          </div>
        )}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={input}
          rows={1}
          value={draft}
          placeholder={busy ? "The agent is working…" : "Ask your agent"}
          aria-label="Message"
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy ? (
          <IconButton icon="stop" label="Stop" variant="tonal" size={48} onClick={() => cmd("chat.stop").catch((e) => snack(e.message))} />
        ) : (
          <IconButton icon="arrow_upward" label="Send" variant="filled" size={48} disabled={!draft.trim()} onClick={send} />
        )}
      </form>
    </aside>
  );
}

/** The first line of a message, without Markdown marks, for notifications. */
function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  const plain = line.replace(/[*`#]/g, "").trim();
  return plain.length > 140 ? plain.slice(0, 139) + "…" : plain;
}

/** Just enough Markdown for chat: paragraphs, lists, **bold**, `code` and code blocks. Never raw HTML. */
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const parts = text.split(/```[^\n]*\n?([\s\S]*?)```/g);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      blocks.push(<pre key={i}><code>{part.replace(/\n$/, "")}</code></pre>);
      return;
    }
    for (const [j, para] of part.split(/\n{2,}/).entries()) {
      const lines = para.split("\n").filter((l) => l.trim());
      if (!lines.length) continue;
      const key = `${i}-${j}`;
      if (lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l))) {
        const ordered = /^\s*\d+\./.test(lines[0]!);
        const items = lines.map((l, k) => <li key={k}>{inline(l.replace(/^\s*([-*]|\d+\.)\s/, ""))}</li>);
        blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
      } else {
        blocks.push(
          <p key={key}>
            {lines.map((l, k) => (
              <span key={k}>
                {k > 0 && <br />}
                {inline(l.replace(/^#+\s*/, ""))}
              </span>
            ))}
          </p>,
        );
      }
    }
  });
  return <>{blocks}</>;
}

function inline(s: string): ReactNode[] {
  return s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((t, i) =>
    t.startsWith("`") && t.endsWith("`") && t.length > 2 ? <code key={i}>{t.slice(1, -1)}</code>
    : t.startsWith("**") && t.endsWith("**") && t.length > 4 ? <strong key={i}>{t.slice(2, -2)}</strong>
    : t,
  );
}
