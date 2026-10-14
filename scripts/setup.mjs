import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getCACertificates } from "node:tls";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const key = `${root}openrouter_key`;
if (!existsSync(key) || !readFileSync(key, "utf8").trim().startsWith("sk-or-")) {
  console.error("Save your OpenRouter key in openrouter_key, then run setup again.");
  process.exit(1);
}

const local = `${root}.local/`;
mkdirSync(local, { recursive: true, mode: 0o700 });
const token = `${local}gateway_token`;
if (!existsSync(token)) writeFileSync(token, randomBytes(32).toString("hex"), { mode: 0o600 });
if (!readFileSync(token, "utf8").trim()) throw new Error("The gateway token file is empty.");

// Export public trust anchors so HTTPS also works behind a trusted host proxy.
const certificates = [
  ...new Set([...getCACertificates("bundled"), ...getCACertificates("system")]),
];
writeFileSync(`${local}host-ca.pem`, certificates.join("\n"));
for (const file of [key, token]) chmodSync(file, 0o600);
if (process.platform === "win32") {
  const account = execFileSync("whoami.exe", { encoding: "utf8" }).trim();
  for (const file of [key, token]) {
    execFileSync(
      "icacls.exe",
      [file, "/inheritance:r", "/grant:r", `${account}:F`, "*S-1-5-18:F"],
      { stdio: "ignore" },
    );
  }
}
console.log(
  "Local credentials and public CA bundle are ready. Existing gateway tokens were preserved.",
);
