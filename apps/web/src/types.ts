export type ToolActivity = {
  id: string;
  name: string;
  target?: string;
  status: "requested" | "running" | "completed" | "failed" | "unknown";
  detail?: string;
};

export type ImageAttachment = {
  id: string;
  type: "image";
  mimeType: string;
  fileName: string;
  content: string;
};
export type MessageImage = { fileName: string; url?: string };

export type Conversation = { id: string; title?: string; updatedAt?: number };
export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  images?: MessageImage[];
  activities?: ToolActivity[];
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
  event: "accepted" | "message" | "activity" | "completed" | "cancelled" | "failed";
  data: {
    conversationId: string;
    requestId: string | null;
    runId: string | null;
    text?: string;
    activities?: ToolActivity[];
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
  attachments?: ImageAttachment[];
  activities?: ToolActivity[];
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
  attachments: Record<string, ImageAttachment[]>;
  imageLoading: Record<string, boolean>;
  imageErrors: Record<string, string>;
  turns: Record<string, Turn>;
};

export type RunCallbacks = {
  change: (turn: Turn) => void;
  accepted: (id: string, input: string, attachments: ImageAttachment[]) => void;
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
  openSettings: () => void;
};

export type ImagePreviewProps = { image: MessageImage };

export type MessagesProps = {
  messages: Message[];
  loading: boolean;
  hasMore: boolean;
  more: () => void;
};

export type ComposerProps = {
  draft: string;
  attachments: ImageAttachment[];
  imageLoading: boolean;
  imageError: string;
  attach: (files: File[]) => void;
  remove: (id: string) => void;
  change: (text: string) => void;
  send: () => void;
  stop: () => void;
  blocked: boolean;
  canStop: boolean;
  stopping: boolean;
};

export type ActivityProps = { activities: ToolActivity[] };

export type GatewayIndicator = { tone: "green" | "amber" | "red"; label: string; reason?: string };
export type SettingsData = {
  baseHash: string;
  chatModel: string;
  imageModel: string;
  canEdit: boolean;
  canApply: boolean;
  phase: string;
  admission: { activeTurns: number; unresolved: boolean; ready: boolean; locked: boolean };
  gateway: GatewayIndicator & {
    version: string;
    reloadMode: string;
    bind: string;
    port: number;
    authenticationEnabled: boolean;
  };
  overrides: { chatModel: string; imageModel: string; notice: string };
  models: {
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
  }[];
  tools: {
    id: string;
    label: string;
    description: string;
    enabled: boolean;
    editable: boolean;
    reason: string;
  }[];
};
export type WorkspaceFileName = "USER.md" | "MEMORY.md";
export type WorkspaceFile = {
  name: WorkspaceFileName;
  content: string;
  missing: boolean;
  size: number;
  hash: string | null;
};
export type FileEditor = {
  saved: WorkspaceFile | null;
  draft: string;
  editing: boolean;
  error: string;
  result: string;
  current?: WorkspaceFile;
};
export type SettingsState = {
  saved: SettingsData | null;
  current: SettingsData | null;
  chatModel: string;
  imageModel: string;
  toolChanges: Record<string, boolean>;
  files: Record<WorkspaceFileName, FileEditor>;
  pending: string;
  error: string;
  result: string;
  indicator: GatewayIndicator | null;
};
export type SettingsPanelProps = {
  controller: import("./settings.ts").SettingsController;
  state: SettingsState;
  open: boolean;
  close: () => void;
};
