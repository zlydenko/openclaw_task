import { groupActivityRows } from "./activity.ts";
import type { ChatState, History, Message, Phase, Turn } from "./types.ts";

export const isBusy = (phase?: Phase) =>
  !!phase && ["sending", "thinking", "responding", "stopping", "checking"].includes(phase);

export const activeTurns = (state: ChatState) =>
  Object.values(state.turns).filter((turn) => isBusy(turn.phase));

export const initialState = (): ChatState => ({
  selected: null,
  items: [],
  nextCursor: null,
  listLoading: false,
  listError: "",
  creating: false,
  ready: false,
  connection: "Connecting…",
  views: {},
  loading: {},
  errors: {},
  drafts: {},
  turns: {},
});

export function mergeById<T extends { id: string }>(items: T[], more: T[]) {
  return [...new Map([...items, ...more].map((item) => [item.id, item])).values()];
}

export function visibleMessages(history?: History, turn?: Turn): Message[] {
  const messages = groupActivityRows(history?.messages ?? []);

  if (!turn || !turn.input) return messages;

  const newUser = messages.findIndex(
    (message) =>
      message.role === "user" &&
      message.text.trim() === turn.input.trim() &&
      !turn.baselineIds.includes(message.id),
  );
  const assistant = newUser >= 0 && messages[newUser + 1]?.role === "assistant";

  if (!isBusy(turn.phase) && newUser >= 0 && (assistant || !turn.text)) return messages;

  const old = newUser < 0 ? messages : messages.slice(0, newUser);

  return [
    ...old,
    {
      id: "user-" + turn.requestId,
      role: "user",
      text: turn.input,
      pending: turn.phase === "sending",
      rejected: turn.phase === "failed" && !turn.runId,
    },
    ...(turn.text || turn.activities?.length
      ? [
          {
            id: "answer-" + turn.requestId,
            role: "assistant" as const,
            text: turn.text,
            activities: turn.activities,
          },
        ]
      : []),
  ];
}

export const phaseLabel = (phase?: Phase) =>
  ({
    sending: "Sending…",
    thinking: "Thinking…",
    responding: "Responding…",
    stopping: "Stopping…",
    checking: "Checking response status…",
    completed: "Response complete",
    cancelled: "Response stopped",
    failed: "Message failed",
    ended: "Run ended · final outcome unknown",
  })[phase ?? "completed"];
