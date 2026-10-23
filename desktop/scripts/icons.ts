// Renders Life's icons with headless Chrome (it has the Material Symbols font):
//   icons/icon.icns              the app icon (the "spa" symbol on Life's purple)
//   icons/trayTemplate(@2x).png  the menu bar icon (a macOS template image: black + alpha)
// Run: bun scripts/icons.ts   (needs Google Chrome; the results are committed)

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dir, "..", "icons");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FONT = "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block";

async function render(html: string, size: number, file: string) {
  const port = 9400 + Math.floor(Math.random() * 400);
  const chrome = Bun.spawn([CHROME, "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${process.env.TMPDIR}/icons-${port}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  try {
    let ws: WebSocket | undefined;
    for (let i = 0; i < 60 && !ws; i++) {
      await Bun.sleep(150);
      try {
        const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t: any) => t.type === "page");
        if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
      } catch {}
    }
    await new Promise((r) => ws!.addEventListener("open", r));
    let id = 0;
    const waiting = new Map<number, (v: any) => void>();
    ws!.addEventListener("message", (m) => {
      const d = JSON.parse(String(m.data));
      waiting.get(d.id)?.(d);
    });
    const send = (method: string, params: any = {}) => new Promise<any>((r) => { waiting.set(++id, r); ws!.send(JSON.stringify({ id, method, params })); });
    await send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    // A real http origin: Chrome won't load the font stylesheet into a data: page.
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(html, { headers: { "content-type": "text/html" } }) });
    await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/` });
    // Wait for the symbol font itself, not just the page.
    const loaded = await send("Runtime.evaluate", {
      expression: `(async () => { for (let i = 0; i < 50; i++) { const f = await document.fonts.load('48px "Material Symbols Rounded"', "spa"); if (f.length) return true; await new Promise((r) => setTimeout(r, 200)); } return false; })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (!loaded.result?.result?.value) throw new Error("the Material Symbols font didn't load");
    await Bun.sleep(300);
    server.stop(true);
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
    await Bun.write(file, Buffer.from(shot.result.data, "base64"));
    ws!.close();
  } finally {
    chrome.kill();
  }
}

const page = (body: string, css: string) => `<!doctype html><html><head><link rel="stylesheet" href="${FONT}"><style>
html,body{margin:0;background:transparent;width:100%;height:100%;overflow:hidden}
.s{font-family:"Material Symbols Rounded";line-height:1;display:block}${css}</style></head><body>${body}</body></html>`;

mkdirSync(OUT, { recursive: true });

// App icon: macOS's rounded square (824 of 1024, centered), Life's purple, the symbol in white.
await render(
  page(`<div class="bg"><span class="s">spa</span></div>`, `
.bg{position:absolute;left:100px;top:100px;width:824px;height:824px;border-radius:185px;
background:linear-gradient(160deg,#7f67be,#5b4397);display:grid;place-items:center;box-shadow:0 10px 24px rgba(0,0,0,.25)}
.bg .s{font-size:520px;color:#fff;font-variation-settings:"FILL" 1,"wght" 500,"opsz" 48}`),
  1024,
  join(OUT, "icon-1024.png"),
);

// Menu bar: black symbol on transparent; macOS tints it for light and dark menu bars.
for (const [size, name] of [[16, "trayTemplate.png"], [32, "trayTemplate@2x.png"]] as const) {
  await render(page(`<span class="s">spa</span>`, `.s{font-size:${size}px;color:#000;font-variation-settings:"FILL" 1,"wght" 500,"opsz" 20}`), size, join(OUT, name));
}

// icon.icns from the 1024 px PNG, with macOS's own tools.
const set = join(OUT, "icon.iconset");
rmSync(set, { recursive: true, force: true });
mkdirSync(set);
for (const s of [16, 32, 128, 256, 512]) {
  Bun.spawnSync(["sips", "-z", String(s), String(s), join(OUT, "icon-1024.png"), "--out", join(set, `icon_${s}x${s}.png`)]);
  Bun.spawnSync(["sips", "-z", String(s * 2), String(s * 2), join(OUT, "icon-1024.png"), "--out", join(set, `icon_${s}x${s}@2x.png`)]);
}
const r = Bun.spawnSync(["iconutil", "-c", "icns", set, "-o", join(OUT, "icon.icns")]);
if (r.exitCode !== 0) throw new Error(r.stderr.toString());
rmSync(set, { recursive: true });
console.log("icons written to", OUT);
