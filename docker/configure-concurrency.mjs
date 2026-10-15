import { readFileSync, renameSync, writeFileSync } from "node:fs";

const file = "/home/node/.openclaw/openclaw.json";
const config = JSON.parse(readFileSync(file, "utf8"));
config.agents ??= {};
config.agents.defaults ??= {};

// Apply the application limit to both new and saved gateway state.
if (config.agents.defaults.maxConcurrent !== 3) {
  config.agents.defaults.maxConcurrent = 3;
  writeFileSync(file + ".tmp", JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  renameSync(file + ".tmp", file);
}
