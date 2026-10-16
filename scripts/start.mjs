import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const scopes = ["operator.admin", "operator.read", "operator.write"];
const sameScopes = (value) =>
  Array.isArray(value) && JSON.stringify([...value].sort()) === JSON.stringify(scopes);
const backend = (row, id) =>
  row?.deviceId === id &&
  row.displayName === "Assessment Hono backend" &&
  row.clientId === "gateway-client" &&
  row.clientMode === "backend";

// Read the identity from this installation's private API volume. Never select a
// device by name alone, by a fixed ID, or by the most recent pairing request.
export function provisionBackend(run) {
  let identity;
  try {
    identity = JSON.parse(
      run([
        "exec",
        "-T",
        "api",
        "node",
        "-e",
        "const fs=require('node:fs'),p=process.env.API_STATE_DIR;const id=JSON.parse(fs.readFileSync(p+'/identity.json','utf8')).deviceId;const s=fs.existsSync(p+'/token.json')?JSON.parse(fs.readFileSync(p+'/token.json','utf8')).scopes:[];process.stdout.write(JSON.stringify({deviceId:id,scopes:s}))",
      ]),
    );
  } catch {
    throw new Error("The local backend identity is unavailable.");
  }
  const id = identity.deviceId;
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("The local backend identity is unavailable.");

  const list = () => {
    try {
      return JSON.parse(
        run([
          "exec",
          "-T",
          "openclaw-gateway",
          "node",
          "dist/index.js",
          "devices",
          "list",
          "--json",
        ]),
      );
    } catch {
      throw new Error("Native device state is unavailable.");
    }
  };
  const state = list();
  const approved = state.paired?.find((row) => backend(row, id) && sameScopes(row.scopes));
  if (approved) {
    if (!sameScopes(identity.scopes)) {
      run(["restart", "api"]);
      return { paired: false, reconnected: true, deviceId: id };
    }
    return { paired: false, deviceId: id };
  }

  const requests = (state.pending ?? []).filter((row) => backend(row, id));
  if (
    requests.length !== 1 ||
    !sameScopes(requests[0].scopes) ||
    !/^[a-f0-9-]{36}$/.test(requests[0].requestId)
  ) {
    throw new Error("The local backend has no matching chat and Settings pairing request.");
  }

  let acknowledged = true;
  try {
    // One native approval for the exact identity created by this installation.
    run([
      "exec",
      "-T",
      "openclaw-gateway",
      "node",
      "dist/index.js",
      "devices",
      "approve",
      requests[0].requestId,
    ]);
  } catch {
    acknowledged = false;
  }
  const confirmed = list().paired?.some((row) => backend(row, id) && sameScopes(row.scopes));
  if (!confirmed)
    throw new Error(
      acknowledged
        ? "Backend access could not be confirmed."
        : "Backend access outcome is unknown. Inspect native device state before another startup.",
    );

  // Reconnect once to obtain the issued token. Keep both persistent volumes.
  run(["restart", "api"]);
  return { paired: true, deviceId: id };
}

export async function start() {
  const compose = [
    "compose",
    "-f",
    "compose.yaml",
    ...(process.env.CUSTOM_CA_FILE ? ["-f", "compose.ca.yaml"] : []),
  ];
  const run = (args, visible = false) => {
    try {
      return (
        execFileSync("docker", [...compose, ...args], {
          cwd: root,
          encoding: "utf8",
          windowsHide: true,
          stdio: visible ? "inherit" : ["ignore", "pipe", "pipe"],
        }) ?? ""
      );
    } catch {
      throw new Error(
        "The local Docker operation failed. Check Docker Desktop and service health.",
      );
    }
  };

  run(["up", "-d", "--build", "--wait", "--wait-timeout", "90"], true);
  provisionBackend(run);

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://localhost:3000/api/settings", {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const settings = await response.json();
        if (settings.canEdit && settings.admission.ready) {
          console.log("Chat and Settings are ready at http://localhost:3000.");
          return;
        }
      }
    } catch {
      /* Poll only read-only readiness. Never repeat a mutation. */
    }
    await setTimeout(500);
  }
  throw new Error(
    "Backend access is configured, but gateway recovery is not ready. Inspect service health.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  start().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
