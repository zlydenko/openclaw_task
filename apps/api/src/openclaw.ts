import { GatewayClient } from "@openclaw/gateway-client";
import {
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
} from "@openclaw/gateway-protocol/client-info";
import { readPairingConnectErrorDetails } from "@openclaw/gateway-protocol/connect-error-details";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";

import { loadGatewayDevice } from "./gateway/device.ts";
import { readChatEvent, sessionKey } from "./gateway/messages.ts";
import { record } from "./validation.ts";
import type { ChatListener, History, Listener, Roster, SendResult } from "./types.ts";

export class OpenClaw {
  private client: GatewayClient;
  private epoch = 0;
  private stopped = false;
  private listeners = new Set<ChatListener>();
  private connectedListeners = new Set<Listener>();
  private disconnectedListeners = new Set<Listener>();
  private gapListeners = new Set<Listener>();
  private subscribed: string | null = null;
  authenticated = false;
  reason = "CONNECTING";

  constructor(directory: string, bootstrapFile: string) {
    const device = loadGatewayDevice(directory, bootstrapFile);
    const url = process.env.GATEWAY_URL ?? "ws://openclaw-gateway:18789";

    // The URL comes from deployment configuration, never from an HTTP request.
    const parsed = new URL(url);

    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new Error("Invalid gateway URL");

    this.client = new GatewayClient({
      url,
      token: device.token,
      deviceIdentity: device.identity,
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
      hostDeps: device.hostDeps,
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
              deviceId: device.identity.deviceId,
              requestId: pairing.requestId,
            }),
          );
      },
      onGap: () => {
        for (const listener of this.gapListeners) listener();
      },
      onEvent: (event) => {
        if (event.event !== "chat") return;

        const payload = readChatEvent(event.payload);

        if (!payload) return;

        for (const listener of this.listeners) listener(payload);
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

  onEvent(listener: ChatListener) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
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
    return this.client.request<Roster>("sessions.list", {
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

  send(id: string, requestId: string, message: string, onSent: Listener) {
    return this.client.request<SendResult>(
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
