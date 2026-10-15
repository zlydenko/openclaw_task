import type { Context, Handler, Hono } from "hono";
import type { DeviceIdentity, GatewayClientHostDeps } from "@openclaw/gateway-client";

export type JsonRecord = Record<string, unknown>;
export type Listener = () => void;
export type ChatListener = (event: ChatEvent) => void;
export type ToolListener = (event: ToolEvent) => void;

export type MessageInput = { requestId: string; text: string };
export type Page = { limit: number; offset: number; emptyOffset: number };
export type ApiStatus = 400 | 404 | 409 | 413 | 503;

export type ApiEnv = {
  Variables: {
    body: JsonRecord;
    messageInput: MessageInput;
    page: Page;
    conversationId: string;
    runId: string;
  };
};

export type ApiApp = Hono<ApiEnv>;
export type ApiContext = Context<ApiEnv>;
export type ApiHandler = Handler<ApiEnv>;

export type ChatController = Record<
  "health" | "ready" | "create" | "list" | "history" | "send" | "cancel",
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
};
