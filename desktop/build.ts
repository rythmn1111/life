// Builds Life for macOS.
//   bun build.ts --js   only the scripts, into dist/ (what `bun run dev` uses)
//   bun build.ts        the app: out/Life-darwin-<arch>/Life.app

import { packager } from "@electron/packager";

const r = await Bun.build({
  entrypoints: ["src/main.ts", "src/preload.ts"],
  outdir: "dist",
  target: "node",
  format: "cjs",
  external: ["electron"],
  naming: "[name].js",
});
if (!r.success) {
  console.error(r.logs.map(String).join("\n"));
  process.exit(1);
}
if (process.argv.includes("--js")) process.exit(0);

const [app] = await packager({
  dir: ".",
  out: "out",
  name: "Life",
  appBundleId: "com.rythmn.life.desktop",
  appCategoryType: "public.app-category.productivity",
  icon: "icons/icon.icns",
  platform: "darwin",
  arch: process.arch as "arm64" | "x64",
  overwrite: true,
  prune: true,
  // Only dist/, pages/, the icons the app uses and package.json go into the app. The app has no
  // runtime packages (Electron is the app itself), so node_modules stays out entirely.
  ignore: [/^\/node_modules/, /^\/src/, /^\/scripts/, /^\/out/, /^\/build\.ts$/, /^\/bun\.lock$/, /^\/tsconfig\.json$/, /^\/\.gitignore$/, /^\/icons\/icon-1024\.png$/],
});
console.log(`built ${app}/Life.app`);
