import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { record, text } from "../validation.ts";
import type { GatewayDevice } from "../types.ts";

function privateJson(path: string, value: unknown) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 });
  chmodSync(`${path}.tmp`, 0o600);
  renameSync(`${path}.tmp`, path);
}

function identityAt(directory: string): GatewayDevice["identity"] {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);

  const path = `${directory}/identity.json`;

  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as GatewayDevice["identity"];

  const keys = generateKeyPairSync("ed25519");
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const raw = keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const identity = {
    deviceId: createHash("sha256").update(raw).digest("hex"),
    publicKeyPem,
    privateKeyPem,
  };

  privateJson(path, identity);

  return identity;
}

export function loadGatewayDevice(directory: string, bootstrapFile: string): GatewayDevice {
  const identity = identityAt(directory);
  const tokenPath = directory + "/token.json";
  const saved = () =>
    existsSync(tokenPath) ? record(JSON.parse(readFileSync(tokenPath, "utf8"))) : {};

  return {
    identity,
    token: text(saved().token) || readFileSync(bootstrapFile, "utf8").trim(),
    hostDeps: {
      signDevicePayload: (key, payload) =>
        sign(null, Buffer.from(payload), key).toString("base64url"),
      publicKeyRawBase64UrlFromPem: (key) =>
        createPublicKey(key)
          .export({ type: "spki", format: "der" })
          .subarray(-32)
          .toString("base64url"),
      loadDeviceAuthToken: () => saved(),
      storeDeviceAuthToken: ({ token, scopes }) => privateJson(tokenPath, { token, scopes }),
      clearDeviceAuthToken: () => privateJson(tokenPath, {}),
      // The SDK can log server error text. Keep logs limited to our safe categories.
      logDebug: () => {},
      logError: () => {},
    },
  };
}
