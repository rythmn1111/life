// The bridge the pages get as window.lifeDesktop. Deliberately small: the dashboard (and
// widget code) can show a notification, report whether the agent is busy, and hear the
// shortcut; only the app's own setup and offline pages may change the server (checked in main).

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("lifeDesktop", {
  platform: process.platform,
  notify: (title: string, body: string) => ipcRenderer.send("notify", { title, body }),
  setBusy: (busy: boolean) => ipcRenderer.send("busy", !!busy),
  onOpenChat: (fn: () => void) => {
    ipcRenderer.on("open-chat", () => fn());
  },
  getServer: (): Promise<string | null> => ipcRenderer.invoke("get-server"),
  setServer: (url: string): Promise<{ server?: string; error?: string }> => ipcRenderer.invoke("set-server", url),
  retry: () => ipcRenderer.send("retry"),
});
