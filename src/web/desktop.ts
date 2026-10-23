// The Mac app's bridge (desktop/src/preload.ts), present when the dashboard runs inside it.

export type DesktopBridge = {
  platform: string;
  notify(title: string, body: string): void;
  setBusy(busy: boolean): void;
  onOpenChat(fn: () => void): void;
};

export const desktop: DesktopBridge | undefined = (globalThis as any).lifeDesktop;

if (desktop) document.documentElement.classList.add("desktop", `desktop-${desktop.platform}`);
