import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  GatewayClient,
  GatewayClientRequestError,
  mergeChatStreamMessage,
  type DeviceIdentity,
} from "@openclaw/gateway-client";
import {
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
} from "@openclaw/gateway-protocol/client-info";
import { readPairingConnectErrorDetails } from "@openclaw/gateway-protocol/connect-error-details";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";

export const namespace = "agent:main:assessment-api-";
export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const text = (value: unknown) => (typeof value === "string" ? value : "");
export const sessionKey = (id: string) => `${namespace}${id}`;
export const conversationId = (key: unknown) => {
  const value = text(key);
  return value.startsWith(namespace) ? value.slice(namespace.length) : null;
};
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ChatEvent = {
  sessionKey: string;
  runId: string;
  seq: number;
  state: string;
  message?: unknown;
  deltaText?: unknown;
  replace?: unknown;
};
export type SessionRow = Record<string, unknown> & { key: string };
export type History = {
  messages?: unknown[];
  sessionId?: string;
  sessionInfo?: Record<string, unknown>;
  inFlightRun?: { runId?: string; text?: string };
  inputReceipts?: { runId: string; state: string }[];
  hasMore?: boolean;
  nextOffset?: number;
};

export function visibleMessage(value: unknown) {
  const message = record(value);
  let unsupported = false;
  const content =
    typeof message.content === "string"
      ? message.content
      : (Array.isArray(message.content) ? message.content : [])
          .flatMap((item) => {
            const block = record(item);
            if (block.type === "text") return [text(block.text)];
            if (block.type !== "thinking" && block.type !== "reasoning") unsupported = true;
            return [];
          })
          .join("");
  return { text: content, unsupported };
}

export function projectMessages(messages: unknown[]) {
  let budget = 400 * 1024;
  const occurrences = new Map<string, number>();
  // Keep every gateway row in the page, but cap each visible projection.
  return messages.flatMap((value) => {
    const row = record(value);
    if (row.role !== "user" && row.role !== "assistant") return [];
    const visible = visibleMessage(row);
    const meta = record(row.__openclaw);
    const base =
      text(meta.id) ||
      text(row.id) ||
      createHash("sha256")
        .update(JSON.stringify([row.role, row.timestamp, visible.text]))
        .digest("hex");
    const sibling = occurrences.get(base) ?? 0;
    occurrences.set(base, sibling + 1);
    const bytes = Buffer.from(visible.text);
    const cap = Math.min(64 * 1024, Math.floor(budget / 6));
    const clipped = bytes
      .subarray(0, cap)
      .toString("utf8")
      .replace(/\uFFFD$/, "");
    budget = Math.max(0, budget - Buffer.byteLength(JSON.stringify(clipped)));
    return [
      {
        id: `${base}:${row.role}:${sibling}`,
        role: row.role,
        text: clipped,
        unsupported: visible.unsupported,
        truncated: bytes.length > cap,
      },
    ];
  });
}

function privateJson(path: string, value: unknown) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 });
  chmodSync(`${path}.tmp`, 0o600);
  renameSync(`${path}.tmp`, path);
}

function identityAt(directory: string): DeviceIdentity {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const path = `${directory}/identity.json`;
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as DeviceIdentity;
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

export class OpenClaw {
  private client: GatewayClient;
  private epoch = 0;
  private stopped = false;
  private listeners = new Set<(event: ChatEvent) => void>();
  private connectedListeners = new Set<() => void>();
  private disconnectedListeners = new Set<() => void>();
  private gapListeners = new Set<() => void>();
  private subscribed: string | null = null;
  authenticated = false;
  reason = "CONNECTING";

  constructor(directory: string, bootstrapFile: string) {
    const identity = identityAt(directory);
    const tokenPath = `${directory}/token.json`;
    const saved = () =>
      existsSync(tokenPath) ? record(JSON.parse(readFileSync(tokenPath, "utf8"))) : {};
    const url = process.env.GATEWAY_URL ?? "ws://openclaw-gateway:18789";
    // The URL comes from deployment configuration, never from an HTTP request.
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new Error("Invalid gateway URL");
    this.client = new GatewayClient({
      url,
      token: text(saved().token) || readFileSync(bootstrapFile, "utf8").trim(),
      deviceIdentity: identity,
      clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      clientDisplayName: "Assessment Hono backend",
      clientVersion: "2026.10.3",
      mode: GATEWAY_CLIENT_MODES.BACKEND,
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      caps: [
        GATEWAY_CLIENT_CAPS.SESSION_SCOPED_EVENTS,
        GATEWAY_CLIENT_CAPS.CHAT_ONLY_ASSISTANT_TEXT,
      ],
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      requestTimeoutMs: 10_000,
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
      onHelloOk: () => {
        this.epoch++;
        this.authenticated = true;
        this.reason = "RECOVERING";
        this.subscribed = null;
        for (const listener of this.connectedListeners) listener();
      },
      onClose: () => {
        this.epoch++;
        this.authenticated = false;
        if (this.reason !== "PAIRING_REQUIRED") this.reason = "GATEWAY_OFFLINE";
        this.subscribed = null;
        for (const listener of this.disconnectedListeners) listener();
      },
      onConnectError: (error) => {
        const pairing = readPairingConnectErrorDetails(record(error).details);
        this.reason = pairing ? "PAIRING_REQUIRED" : "GATEWAY_OFFLINE";
        if (pairing)
          console.log(
            JSON.stringify({
              event: "pairing_required",
              deviceId: identity.deviceId,
              requestId: pairing.requestId,
            }),
          );
      },
      onGap: () => {
        for (const listener of this.gapListeners) listener();
      },
      onEvent: (event) => {
        if (event.event !== "chat") return;
        const payload = record(event.payload);
        if (
          typeof payload.sessionKey !== "string" ||
          typeof payload.runId !== "string" ||
          !Number.isInteger(payload.seq)
        )
          return;
        for (const listener of this.listeners) listener(payload as ChatEvent);
      },
    });
  }

  start() {
    this.client.start();
  }
  async stop() {
    this.stopped = true;
    await this.client.stopAndWait({ timeoutMs: 2000 });
  }
  onEvent(listener: (event: ChatEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  onConnected(listener: () => void) {
    this.connectedListeners.add(listener);
  }
  onDisconnected(listener: () => void) {
    this.disconnectedListeners.add(listener);
  }

  onGap(listener: () => void) {
    this.gapListeners.add(listener);
  }

  async roster(limit = 50, offset = 0, activeOnly = false, search = "assessment-api-") {
    return this.client.request<{
      sessions: SessionRow[];
      hasMore?: boolean;
      nextOffset?: number;
      total?: number;
    }>("sessions.list", {
      agentId: "main",
      search,
      limit,
      offset,
      activeOnly,
      includeDerivedTitles: true,
      includeGlobal: false,
      includeUnknown: false,
      excludeSubagents: true,
      excludeCron: true,
      excludeSystem: true,
    });
  }

  async subscribe(id: string) {
    const key = sessionKey(id);
    if (this.subscribed === key) return;
    if (this.subscribed)
      await this.client.request("sessions.messages.unsubscribe", { key: this.subscribed });
    await this.client.request("sessions.messages.subscribe", { key });
    this.subscribed = key;
  }

  history(id: string, limit = 50, offset = 0, runId?: string) {
    return this.client.request<History>("chat.history", {
      sessionKey: sessionKey(id),
      limit,
      offset,
      maxBytes: 480 * 1024,
      ...(runId ? { inputRunIds: [runId] } : {}),
    });
  }

  send(id: string, requestId: string, message: string, onSent: () => void) {
    return this.client.request<{ runId: string; status?: string }>(
      "chat.send",
      {
        sessionKey: sessionKey(id),
        message,
        idempotencyKey: requestId,
        timeoutMs: 180_000,
        deliver: false,
      },
      { onSent },
    );
  }
  cancel(id: string, runId: string) {
    return this.client.request("chat.abort", { sessionKey: sessionKey(id), runId });
  }

  async recoverSubscription() {
    const epoch = this.epoch;
    await this.client.request("sessions.subscribe", {});
    if (this.stopped || epoch !== this.epoch || !this.authenticated)
      throw new Error("Connection changed");
    return epoch;
  }
  isCurrent(epoch: number) {
    return !this.stopped && this.authenticated && epoch === this.epoch;
  }
}

export { GatewayClientRequestError, mergeChatStreamMessage };
