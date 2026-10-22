// Material 3 dynamic color: every --md-sys-color-* role from one seed color, with the 2025
// (Expressive) color spec. The theme lives in the personal layer (layer/theme.json).

import {
  type DynamicScheme,
  Hct,
  MaterialDynamicColors,
  SchemeContent,
  SchemeExpressive,
  SchemeFidelity,
  SchemeFruitSalad,
  SchemeMonochrome,
  SchemeNeutral,
  SchemeRainbow,
  SchemeTonalSpot,
  SchemeVibrant,
  argbFromHex,
  hexFromArgb,
} from "@material/material-color-utilities";

export type Theme = { seed: string; variant: string; mode: "auto" | "light" | "dark" };
export const DEFAULT_THEME: Theme = { seed: "#6750A4", variant: "tonal_spot", mode: "auto" };

const SCHEMES: Record<string, new (hct: Hct, dark: boolean, contrast: number, spec?: "2021" | "2025") => DynamicScheme> = {
  tonal_spot: SchemeTonalSpot,
  expressive: SchemeExpressive,
  vibrant: SchemeVibrant,
  neutral: SchemeNeutral,
  fidelity: SchemeFidelity,
  content: SchemeContent,
  monochrome: SchemeMonochrome,
  rainbow: SchemeRainbow,
  fruit_salad: SchemeFruitSalad,
};

const colors = new MaterialDynamicColors().allColors.filter(Boolean);

function roles(t: Theme, dark: boolean): { css: string; surface: string } {
  const Scheme = SCHEMES[t.variant] ?? SchemeTonalSpot;
  const s = new Scheme(Hct.fromInt(argbFromHex(t.seed)), dark, 0, "2025");
  const css = colors.map((c) => `--md-sys-color-${c.name.replaceAll("_", "-")}:${hexFromArgb(c.getArgb(s))};`).join("");
  return { css, surface: hexFromArgb(MaterialDynamicColors.surface.getArgb(s)) };
}

let current: Theme = DEFAULT_THEME;
const media = matchMedia("(prefers-color-scheme: dark)");
media.addEventListener("change", () => current.mode === "auto" && applyTheme(current));

export function applyTheme(t: Theme) {
  current = t;
  const light = roles(t, false);
  const dark = roles(t, true);
  const css =
    t.mode === "light" ? `:root{${light.css}color-scheme:light}`
    : t.mode === "dark" ? `:root{${dark.css}color-scheme:dark}`
    : `:root{${light.css}color-scheme:light}@media (prefers-color-scheme: dark){:root{${dark.css}color-scheme:dark}}`;
  let style = document.getElementById("life-theme");
  if (!style) {
    style = document.createElement("style");
    style.id = "life-theme";
    document.head.append(style);
  }
  style.textContent = css;
  const isDark = t.mode === "dark" || (t.mode === "auto" && media.matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", isDark ? dark.surface : light.surface);
  try {
    localStorage.setItem("life-theme", JSON.stringify(t));
  } catch {}
}

/** The last theme this browser saw, so the page doesn't flash before signing in. */
export function cachedTheme(): Theme {
  try {
    return { ...DEFAULT_THEME, ...JSON.parse(localStorage.getItem("life-theme") ?? "{}") };
  } catch {
    return DEFAULT_THEME;
  }
}
