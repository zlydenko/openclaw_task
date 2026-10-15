import { readEvents } from "./events.ts";
import type { Conversation, History, Page, StreamEvent } from "./types.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly outcomeUnknown = false,
    readonly runId: string | null = null,
  ) {
    super(message);
  }
}

async function check(response: Response) {
  if (response.ok) return response;

  const body = await response.json().catch(() => null);
  const error = body?.error;

  throw new ApiError(
    response.status,
    typeof error?.code === "string"
      ? error.code
      : typeof body?.reason === "string"
        ? body.reason
        : "HTTP_ERROR",
    typeof error?.message === "string"
      ? error.message
      : "The server could not complete this request.",
    error?.outcomeUnknown === true,
    typeof error?.runId === "string" ? error.runId : null,
  );
}

async function json<T>(url: string, body?: object): Promise<T> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  return (await check(response)).json();
}

const page = (cursor?: string) => (cursor ? "?cursor=" + encodeURIComponent(cursor) : "");
const conversation = (id: string) => "/api/conversations/" + encodeURIComponent(id);

export const api = {
  ready: async () => {
    const result = await json<{ status: string; reason?: string }>("/ready");

    return result.status === "ready";
  },
  list: (cursor?: string) => json<Page<Conversation>>("/api/conversations" + page(cursor)),
  create: () => json<{ id: string }>("/api/conversations", {}),
  history: (id: string, cursor?: string) => json<History>(conversation(id) + page(cursor)),
  cancel: (id: string, runId: string) =>
    json(conversation(id) + "/runs/" + encodeURIComponent(runId) + "/cancel", {}),
  send: async (
    id: string,
    requestId: string,
    text: string,
    receive: (event: StreamEvent) => void,
    signal: AbortSignal,
  ) => {
    const response = await check(
      await fetch(conversation(id) + "/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ requestId, text }),
        signal,
      }),
    );

    if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
      throw new Error("The response stream is unavailable.");
    }

    await readEvents(response.body, receive);
  },
};
