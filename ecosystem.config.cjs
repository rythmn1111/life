// pm2 config for the VPS. The code is this repo, pulled from GitHub (D1); the data lives in
// /var/lib/life and is never in git (D2). Start or reload with:
//   pm2 startOrReload ecosystem.config.cjs --only life --update-env

const { existsSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");

const bun = [join(homedir(), ".bun", "bin", "bun"), "/usr/local/bin/bun"].find(existsSync) ?? "bun";

module.exports = {
  apps: [
    {
      name: "life",
      script: "src/server.ts",
      interpreter: bun,
      cwd: __dirname,
      max_restarts: 50,
      restart_delay: 3000,
      env: { LIFE_DATA: "/var/lib/life", LIFE_HOST: "0.0.0.0", LIFE_PORT: "8810" },
    },
  ],
};
