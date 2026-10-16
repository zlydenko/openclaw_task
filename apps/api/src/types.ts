import type { Context, Handler, Hono } from "hono";
import type { DeviceIdentity, GatewayClientHostDeps } from "@openclaw/gateway-client";

export type JsonRecord = Record<string, unknown>;
export type Listener = () => void;
export type ChatListener = (event: ChatEvent) => void;
export type ToolListener = (event: ToolEvent) => void;

export type ImageAttachment = {
  type: "image";
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  fileName: string;
  content: string;
};

export type MessageInput = { requestId: string; text: string; attachments?: ImageAttachment[] };
export type MessageImage = { fileName: string; url?: string };
export type StoredImage = { fileName: string; source?: string };
export type ImageContent = { bytes: Uint8Array<ArrayBuffer>; mimeType: string };
export type MessageResult = { ok: boolean; message?: unknown };
export type Page = { limit: number; offset: number; emptyOffset: number };
export type ApiStatus = 400 | 403 | 404 | 409 | 413 | 503;

export type ApiEnv = {
  Variables: {
    body: JsonRecord;
    messageInput: MessageInput;
    page: Page;
    conversationId: string;
    runId: string;
    imageMessageId: string;
    imageIndex: number;
    settingsInput: SettingsInput;
    workspaceFileInput: FileInput;
    workspaceFileName: WorkspaceFileName;
  };
};

export type ApiApp = Hono<ApiEnv>;
export type ApiContext = Context<ApiEnv>;
export type ApiHandler = Handler<ApiEnv>;

export type ChatController = Record<
  "health" | "ready" | "create" | "list" | "history" | "image" | "send" | "cancel",
  ApiHandler
>;

export type ChatEvent = {
  sessionKey: string;
  runId: string;
  seq: number;
  state: string;
  message?: unknown;
  deltaText?: unknown;
  replace?: unknown;
};

export type ToolActivity = {
  id: string;
  name: string;
  target?: string;
  status: "requested" | "running" | "completed" | "failed" | "unknown";
  detail?: string;
};

export type ToolEvent = {
  sessionKey?: string;
  runId: string;
  seq: number;
  activity: ToolActivity;
};

export type SessionRow = JsonRecord & { key: string };

export type Roster = {
  sessions: SessionRow[];
  hasMore?: boolean;
  nextOffset?: number;
  total?: number;
};

export type History = {
  messages?: unknown[];
  totalMessages?: number;
  sessionId?: string;
  sessionInfo?: JsonRecord;
  inFlightRun?: { runId?: string; text?: string };
  inputReceipts?: { runId: string; state: string }[];
  hasMore?: boolean;
  nextOffset?: number;
};

export type SendResult = { runId: string; status?: string };

export type GatewayDevice = {
  identity: DeviceIdentity;
  token: string;
  scopes: string[];
  hostDeps: GatewayClientHostDeps;
};

export type ConversationItem = { id: string; title?: string; updatedAt?: number };

export type StreamEvent = {
  event: "accepted" | "message" | "activity" | "completed" | "cancelled" | "failed";
  data: JsonRecord;
};

export type StreamListener = (event: StreamEvent) => void;
export type TerminalEvent = "completed" | "cancelled" | "failed";

export type Run = {
  conversationId: string;
  requestId: string | null;
  runId: string | null;
  hash: string;
  sent: boolean;
  accepted: boolean;
  uncertain: boolean;
  done: boolean;
  startedAt: number;
  limited: boolean;
  finishedAt?: number;
  seq: number;
  message: unknown;
  text: string;
  last?: StreamEvent;
  activities: Map<string, ToolActivity>;
  toolSeq: number;
  earlyTools: ToolEvent[];
  early: ChatEvent[];
  earlyBytes: number;
  observers: Set<StreamListener>;
};

export type Submission = Pick<Run, "conversationId" | "requestId" | "runId"> & {
  observe: (listener: StreamListener) => Listener;
};

export type RunLifecycle = {
  idle: (id: string) => void;
  uncertain: Listener;
  recover: Listener;
};

export type ProjectedMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  unsupported?: boolean;
  truncated?: boolean;
  activities?: ToolActivity[];
  images?: MessageImage[];
};

export type SettingsInput = {
  baseHash: string;
  chatModel?: string;
  imageModel?: string;
  toolChanges?: Record<string, boolean>;
};
export type WorkspaceFileName = "USER.md" | "MEMORY.md";
export type FileInput = { content: string; expectedHash?: string; expectedMissing?: true };
export type WorkspaceFile = {
  name: WorkspaceFileName;
  content: string;
  missing: boolean;
  size: number;
  hash: string | null;
};
export type ConfigSnapshot = JsonRecord & {
  config: JsonRecord;
  hash: string;
  valid: boolean;
  configRevisionHash?: string;
  appliedConfigHash?: string;
};
export type SettingsPhase = "idle" | "applying" | "saving" | "unconfirmed" | "failed";
export type ModelChoice = {
  id: string;
  name: string;
  input: string[];
  tools: boolean;
  contextWindow: number;
  inputPrice: number;
  outputPrice: number;
  priceDate: string;
  api: string;
  verified: string;
};
export type SettingsTool = {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  editable: boolean;
  reason: string;
};
