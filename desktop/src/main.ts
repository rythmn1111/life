// Life for macOS: a native window onto your Life server (the VPS, or a local one), plus
// what a browser tab can't do: a menu bar icon, a global shortcut to the agent, native
// notifications and launch at login. The UI itself always comes from the server, so a
// core update on the server reaches this app without rebuilding it.

import { BrowserWindow, Menu, Notification, Tray, app, globalShortcut, ipcMain, nativeImage, nativeTheme, shell } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// The app's own folder (inside Life.app when packaged). Not __dirname: the bundler fixes that at build time.
const ROOT = app.getAppPath();
const PAGES = join(ROOT, "pages");
const ICONS = join(ROOT, "icons");

// ---------- settings ----------

type Settings = { server: string | null; shortcut: string };
const DEFAULTS: Settings = { server: null, shortcut: "CommandOrControl+Shift+L" };
const settingsFile = () => join(app.getPath("userData"), "settings.json");

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(settingsFile(), "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s: Settings) {
  mkdirSync(dirname(settingsFile()), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(s, null, 2) + "\n");
}

/** "http://host:port" from what the user typed, or null if it isn't an http(s) address. */
function normalize(input: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `http://${input.trim()}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

// ---------- state ----------

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let busy = false;
let quitting = false;

const isLocalPage = (url: string) => url.startsWith("file://");
const isServer = (url: string) => {
  const s = load().server;
  try {
    return !!s && new URL(url).origin === s;
  } catch {
    return false;
  }
};

// ---------- the window ----------

function createWindow(hidden: boolean) {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 520,
    show: false,
    title: "Life",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 22 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#141218" : "#fdf7fe",
    webPreferences: {
      preload: join(ROOT, "dist", "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      partition: "persist:life", // keeps you signed in between launches
      backgroundThrottling: false, // live updates and widget reminders keep working while hidden
    },
  });
  win.once("ready-to-show", () => !hidden && win?.show());
  // Closing the window keeps Life in the menu bar; Quit (⌘Q) really quits.
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });

  // Stay on the server and the app's own pages; everything else opens in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!isServer(url) && !isLocalPage(url)) {
      e.preventDefault();
      openExternal(url);
    }
  });
  // Save the sign-in cookie as soon as a page loads, not only at a clean quit.
  win.webContents.on("did-finish-load", () => win?.webContents.session.cookies.flushStore());
  win.webContents.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && isServer(url)) showOffline(description);
  });
  openServer();
}

function openExternal(url: string) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

function openServer() {
  const { server } = load();
  if (!server) win?.loadFile(join(PAGES, "setup.html"));
  else win?.loadURL(server);
}

function showOffline(reason: string) {
  win?.loadFile(join(PAGES, "offline.html"), { query: { server: load().server ?? "", reason } });
}

function show() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function askAgent() {
  show();
  win?.webContents.send("open-chat");
}

// ---------- menu bar and app menu ----------

function trayIcon() {
  const img = nativeImage.createFromPath(join(ICONS, "trayTemplate.png"));
  img.setTemplateImage(true);
  return img;
}

function serverLabel() {
  const s = load().server;
  return s ? `Server: ${new URL(s).host}` : "No server yet";
}

function refreshTray() {
  if (!tray) return;
  const { shortcut } = load();
  tray.setToolTip(busy ? "Life: the agent is working" : "Life");
  tray.setTitle(busy ? "…" : "");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: busy ? "The agent is working…" : "The agent is idle", enabled: false },
      { type: "separator" },
      { label: "Open Life", click: show },
      { label: "Ask the Agent", accelerator: shortcut, click: askAgent },
      { type: "separator" },
      { label: serverLabel(), enabled: false },
      {
        label: "Change Server…",
        click: () => {
          show();
          win?.loadFile(join(PAGES, "setup.html"));
        },
      },
      {
        label: "Launch at Login",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
      },
      { type: "separator" },
      { label: "Quit Life", accelerator: "Command+Q", click: () => app.quit() },
    ]),
  );
}

function appMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "editMenu" }, // copy and paste in text fields need this on macOS
      {
        label: "View",
        submenu: [
          { label: "Ask the Agent", accelerator: load().shortcut, click: askAgent },
          { type: "separator" },
          { role: "reload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
}

// ---------- messages from the pages ----------

ipcMain.on("notify", (e, { title, body }: { title: string; body: string }) => {
  if (!isServer(e.senderFrame?.url ?? "") || !Notification.isSupported()) return;
  const n = new Notification({ title: String(title).slice(0, 120), body: String(body ?? "").slice(0, 300), silent: false });
  n.on("click", askAgent);
  n.show();
});

ipcMain.on("busy", (e, value: boolean) => {
  if (!isServer(e.senderFrame?.url ?? "")) return;
  busy = !!value;
  refreshTray();
});

// Only the app's own setup and offline pages may change the server.
ipcMain.handle("get-server", () => load().server);
ipcMain.handle("set-server", (e, input: string) => {
  if (!isLocalPage(e.senderFrame?.url ?? "")) return { error: "not allowed" };
  const server = normalize(String(input));
  if (!server) return { error: "That isn't a web address. Try something like http://203.0.113.5:8810" };
  save({ ...load(), server });
  refreshTray();
  openServer();
  return { server };
});
ipcMain.on("retry", (e) => isLocalPage(e.senderFrame?.url ?? "") && openServer());

// ---------- start ----------

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", show);
app.on("activate", show); // clicking the Dock icon
app.on("before-quit", () => (quitting = true));
app.on("will-quit", () => globalShortcut.unregisterAll());

app.whenReady().then(() => {
  appMenu();
  // Opened at login: start quietly in the menu bar.
  const hidden = app.getLoginItemSettings().wasOpenedAtLogin;
  createWindow(hidden);
  tray = new Tray(trayIcon());
  refreshTray();
  const { shortcut } = load();
  if (!globalShortcut.register(shortcut, askAgent)) console.warn(`life: couldn't register the shortcut ${shortcut}`);
});
