import { GatewayClient } from "@openclaw/gateway-client";
import { readFileSync } from "node:fs";
import {
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
} from "@openclaw/gateway-protocol/client-info";
import { readPairingConnectErrorDetails } from "@openclaw/gateway-protocol/connect-error-details";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";

import { readGatewayImage } from "./gateway/images.ts";
import { readToolEvent } from "./gateway/activity.ts";
import { loadGatewayDevice } from "./gateway/device.ts";
import { conversationId, legacyNamespace, readChatEvent, sessionKey } from "./gateway/messages.ts";
import { record } from "./validation.ts";
import type {
  ChatListener,
  History,
  ImageAttachment,
  MessageResult,
  Listener,
  Roster,
  SendResult,
  ToolListener,
  ConfigSnapshot,
  FileInput,
  JsonRecord,
  WorkspaceFileName,
} from "./types.ts";

export class OpenClaw {
  private client: GatewayClient;
  private mediaBase: URL;
  private mediaToken: () => string;
  private epoch = 0;
  private stopped = false;
  private listeners = new Set<ChatListener>();
  private toolListeners = new Set<ToolListener>();
  private connectedListeners = new Set<Listener>();
  private disconnectedListeners = new Set<Listener>();
  private gapListeners = new Set<Listener>();
  private subscribed = new Set<string>();
  private subscriptionQueue = Promise.resolve();
  private legacySessions = new Set<string>();
  authenticated = false;
  reason = "CONNECTING";
  settingsAdmin = false;
  restarting = false;
  version = "2026.10.3";

  constructor(directory: string, bootstrapFile: string) {
    const device = loadGatewayDevice(directory, bootstrapFile);
    const url = process.env.GATEWAY_URL ?? "ws://openclaw-gateway:18789";

    // The URL comes from deployment configuration, never from an HTTP request.
    const parsed = new URL(url);

    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new Error("Invalid gateway URL");

    this.mediaBase = new URL(parsed);
    this.mediaBase.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
    this.mediaToken = () => device.token;

    let requestingAdmin = device.scopes.length > 0;
    const makeClient = () =>
      new GatewayClient({
        url,
        token:
          requestingAdmin && !device.scopes.includes("operator.admin")
            ? readFileSync(bootstrapFile, "utf8").trim()
            : device.token,
        deviceIdentity: device.identity,
        clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
        clientDisplayName: "Assessment Hono backend",
        clientVersion: "2026.10.3",
        mode: GATEWAY_CLIENT_MODES.BACKEND,
        role: "operator",
        scopes: ["operator.read", "operator.write", ...(requestingAdmin ? ["operator.admin"] : [])],
        caps: [
          GATEWAY_CLIENT_CAPS.SESSION_SCOPED_EVENTS,
          GATEWAY_CLIENT_CAPS.TOOL_EVENTS,
          GATEWAY_CLIENT_CAPS.CHAT_ONLY_ASSISTANT_TEXT,
        ],
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        requestTimeoutMs: 10_000,
        hostDeps: {
          ...device.hostDeps,
          // An optional scope upgrade must not erase a working chat credential.
          clearDeviceAuthToken: (params) =>
            requestingAdmin ? undefined : device.hostDeps.clearDeviceAuthToken?.(params),
        },
        onHelloOk: (hello) => {
          this.settingsAdmin = hello.auth?.scopes?.includes("operator.admin") === true;
          const version = record(hello.server).version;
          if (typeof version === "string" && /^[\w.+-]{1,64}$/.test(version))
            this.version = version;
          this.restarting = false;
          this.epoch++;
          this.authenticated = true;
          this.reason = "RECOVERING";
          this.subscribed.clear();
          this.subscriptionQueue = Promise.resolve();

          for (const listener of this.connectedListeners) listener();
        },
        onClose: () => {
          const wasAuthenticated = this.authenticated;
          this.epoch++;
          this.authenticated = false;
          if (wasAuthenticated) this.reason = "RECONNECTING";
          this.subscribed.clear();
          this.subscriptionQueue = Promise.resolve();

          for (const listener of this.disconnectedListeners) listener();
        },
        onConnectError: (error) => {
          const pairing = readPairingConnectErrorDetails(record(error).details);
          this.reason = pairing ? "PAIRING_REQUIRED" : "GATEWAY_OFFLINE";

          if (pairing)
            console.log(
              JSON.stringify({
                event: "pairing_required",
                deviceId: device.identity.deviceId,
                requestId: pairing.requestId,
              }),
            );
          if (requestingAdmin && !this.stopped) {
            requestingAdmin = false;
            const previous = this.client;
            void previous.stopAndWait({ timeoutMs: 2000 }).then(() => {
              if (this.stopped) return;
              this.client = makeClient();
              this.client.start();
            });
          }
        },
        onGap: () => {
          for (const listener of this.gapListeners) listener();
        },
        onEvent: (event) => {
          if (event.event === "shutdown") {
            this.restarting = typeof record(event.payload).restartExpectedMs === "number";
          }
          if (event.event === "agent") {
            const envelope = record(event.payload);
            const tool = readToolEvent(envelope, String(envelope.stream));

            if (tool) for (const listener of this.toolListeners) listener(tool);
            return;
          }
          if (event.event !== "chat") return;

          const payload = readChatEvent(event.payload);

          if (!payload) return;

          for (const listener of this.listeners) listener(payload);
        },
      });
    this.client = makeClient();
  }

  settingsConfig() {
    return this.client.request<ConfigSnapshot>("config.get", {});
  }

  settingsTools() {
    return this.client.request<JsonRecord>("tools.catalog", {
      agentId: "main",
      includePlugins: true,
    });
  }

  async settingsEffective() {
    const roster = await this.roster(1);
    const key = roster.sessions[0]?.key;
    if (!key) return {};
    return this.client.request<JsonRecord>("tools.effective", { agentId: "main", sessionKey: key });
  }

  settingsSchema(path: string) {
    return this.client.request<JsonRecord>("config.schema.lookup", { path });
  }

  settingsPatch(patch: JsonRecord, baseHash: string, replacePaths: string[], onSent: Listener) {
    return this.client.request<JsonRecord>(
      "config.patch",
      { raw: JSON.stringify(patch), baseHash, ...(replacePaths.length ? { replacePaths } : {}) },
      { timeoutMs: 60000, onSent },
    );
  }

  settingsFile(name: WorkspaceFileName) {
    return this.client.request<JsonRecord>("agents.files.get", { agentId: "main", name });
  }

  settingsSaveFile(name: WorkspaceFileName, input: FileInput, onSent: Listener) {
    return this.client.request<JsonRecord>(
      "agents.files.set",
      { agentId: "main", name, ...input },
      { timeoutMs: 15000, onSent },
    );
  }

  start() {
    this.client.start();
  }

  async stop() {
    this.stopped = true;
    await this.client.stopAndWait({ timeoutMs: 2000 });
  }

  onEvent(listener: ChatListener) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  onTool(listener: ToolListener) {
    this.toolListeners.add(listener);

    return () => {
      this.toolListeners.delete(listener);
    };
  }

  onConnected(listener: Listener) {
    this.connectedListeners.add(listener);
  }

  onDisconnected(listener: Listener) {
    this.disconnectedListeners.add(listener);
  }

  onGap(listener: Listener) {
    this.gapListeners.add(listener);
  }

  async roster(limit = 50, offset = 0, activeOnly = false, search = "assessment-api-") {
    const result = await this.client.request<Roster>("sessions.list", {
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

    for (const row of result.sessions) {
      const id = conversationId(row.key);

      if (id && row.key.startsWith(legacyNamespace)) this.legacySessions.add(id);
    }

    return result;
  }

  private key(id: string) {
    return this.legacySessions.has(id) ? legacyNamespace + id : sessionKey(id);
  }

  subscribe(id: string) {
    return this.setSubscription(id, true);
  }

  unsubscribe(id: string) {
    return this.setSubscription(id, false);
  }

  private setSubscription(id: string, enabled: boolean) {
    const key = this.key(id);
    const epoch = this.epoch;
    const pending = this.subscriptionQueue.then(async () => {
      if (!this.isCurrent(epoch)) throw new Error("Connection changed");
      if (this.subscribed.has(key) === enabled) return;

      await this.client.request(
        enabled ? "sessions.messages.subscribe" : "sessions.messages.unsubscribe",
        { key },
      );
      if (!this.isCurrent(epoch)) throw new Error("Connection changed");
      if (enabled) this.subscribed.add(key);
      else this.subscribed.delete(key);
    });
    this.subscriptionQueue = pending.catch(() => {});

    return pending;
  }

  history(id: string, limit = 50, offset = 0, runId?: string) {
    return this.client.request<History>("chat.history", {
      sessionKey: this.key(id),
      limit,
      offset,
      maxBytes: 480 * 1024,
      ...(runId ? { inputRunIds: [runId] } : {}),
    });
  }

  message(id: string, messageId: string) {
    return this.client.request<MessageResult>("chat.message.get", {
      sessionKey: this.key(id),
      messageId,
      maxChars: 480 * 1024,
    });
  }

  image(id: string, source: string) {
    return readGatewayImage(this.mediaBase, this.mediaToken(), this.key(id), source);
  }

  send(
    id: string,
    requestId: string,
    message: string,
    onSent: Listener,
    attachments?: ImageAttachment[],
  ) {
    return this.client.request<SendResult>(
      "chat.send",
      {
        sessionKey: this.key(id),
        message,
        ...(attachments?.length ? { attachments } : {}),
        idempotencyKey: requestId,
        timeoutMs: 180_000,
        deliver: false,
      },
      { onSent },
    );
  }

  cancel(id: string, runId: string) {
    return this.client.request("chat.abort", { sessionKey: this.key(id), runId });
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
