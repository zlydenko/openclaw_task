export type Conversation = { id: string; title?: string; updatedAt?: number };
export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  unsupported?: boolean;
  truncated?: boolean;
  pending?: boolean;
  rejected?: boolean;
};

export type Page<T> = { items: T[]; nextCursor: string | null };
export type History = {
  id: string;
  messages: Message[];
  nextCursor: string | null;
  activeRun: { runId: string | null; requestId: string | null } | null;
  syncState: "ready" | "uncertain";
};

export type StreamEvent = {
  event: "accepted" | "message" | "completed" | "cancelled" | "failed";
  data: {
    conversationId: string;
    requestId: string | null;
    runId: string | null;
    text?: string;
    code?: string;
    message?: string;
    outcomeUnknown?: boolean;
  };
};

export type Phase =
  | "sending"
  | "thinking"
  | "responding"
  | "stopping"
  | "checking"
  | "completed"
  | "cancelled"
  | "failed"
  | "ended";

export type Turn = {
  conversationId: string;
  requestId: string | null;
  runId: string | null;
  input: string;
  text: string;
  phase: Phase;
  notice: string;
  baselineIds: string[];
};

export type ChatState = {
  selected: string | null;
  items: Conversation[];
  nextCursor: string | null;
  listLoading: boolean;
  listError: string;
  creating: boolean;
  ready: boolean;
  connection: string;
  views: Record<string, History>;
  loading: Record<string, boolean>;
  errors: Record<string, string>;
  drafts: Record<string, string>;
  turns: Record<string, Turn>;
  active: Turn | null;
};

export type RunCallbacks = {
  change: (turn: Turn) => void;
  accepted: (id: string, input: string) => void;
  settled: (id: string) => void;
};

export type SidebarProps = {
  state: ChatState;
  open: boolean;
  mobile: boolean;
  select: (id: string) => void;
  create: () => void;
  more: () => void;
  close: () => void;
  theme: string;
  toggleTheme: () => void;
};

export type MessagesProps = {
  messages: Message[];
  loading: boolean;
  hasMore: boolean;
  more: () => void;
};

export type ComposerProps = {
  draft: string;
  change: (text: string) => void;
  send: () => void;
  stop: () => void;
  blocked: boolean;
  canStop: boolean;
  stopping: boolean;
};
