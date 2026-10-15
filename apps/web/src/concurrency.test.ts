import { afterEach, expect, it, vi } from "vitest";

import { createApp } from "../../api/src/app.ts";
import { Chat } from "../../api/src/chat.ts";
import { sessionKey } from "../../api/src/gateway/messages.ts";
import type { OpenClaw } from "../../api/src/openclaw.ts";
import type { ChatEvent, History, ToolEvent } from "../../api/src/types.ts";
import { ChatController } from "./chat.ts";
import { activeTurns } from "./state.ts";

const disposals: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.unstubAllGlobals();
});

function setup() {
  let chatEvent!: (event: ChatEvent) => void;
  let toolEvent!: (event: ToolEvent) => void;
  let connected!: () => void;
  let disconnected!: () => void;
  let gap!: () => void;
  const saved = new Map<string, History>();
  const submissions = new Map<string, { requestId: string; runId: string }>();
  const gateway = {
    authenticated: true,
    onConnected: (fn: typeof connected) => {
      connected = fn;
    },
    onDisconnected: (fn: typeof disconnected) => {
      disconnected = fn;
    },
    onGap: (fn: typeof gap) => {
      gap = fn;
    },
    onEvent: (fn: typeof chatEvent) => {
      chatEvent = fn;
    },
    onTool: (fn: typeof toolEvent) => {
      toolEvent = fn;
    },
    subscribe: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => {}),
    recoverSubscription: vi.fn(async () => 1),
    isCurrent: () => gateway.authenticated,
    roster: vi.fn(async (_limit = 50, offset = 0, activeOnly = false) => ({
      sessions: [...saved]
        .slice(offset, offset + 2)
        .map(([id, history]) => ({
          key: sessionKey(id),
          hasActiveRun: !!history.inFlightRun,
        }))
        .filter((row) => !activeOnly || row.hasActiveRun),
      hasMore: offset + 2 < saved.size,
      nextOffset: offset + 2,
    })),
    history: vi.fn(async (id: string) => saved.get(id) ?? {}),
    send: vi.fn(async (id: string, requestId: string, input: string, sent: () => void) => {
      sent();
      const runId = "run-" + requestId;
      submissions.set(id, { requestId, runId });
      saved.set(id, {
        messages: [{ id: "user-" + id, role: "user", content: input }],
        inFlightRun: { runId, text: "" },
        sessionInfo: { activeRunIds: [runId] },
      });
      // Tool events can arrive without a session key before chat.send acknowledges.
      toolEvent({ runId, seq: 1, activity: { id: "tool", name: "read", status: "running" } });
      return { runId };
    }),
    cancel: vi.fn(async () => {}),
  };
  const chat = new Chat(gateway as unknown as OpenClaw);
  chat.ready = true;
  const app = createApp(chat);
  const request = (path: string, options?: RequestInit) =>
    app.request(new URL(path, "http://localhost:3000"), {
      ...options,
      headers: { ...options?.headers, host: "localhost:3000" },
    });
  vi.stubGlobal("fetch", vi.fn(request));
  const browser = new ChatController();
  disposals.push(() => {
    browser.close();
    chat.close();
  });

  const publish = (id: string, seq: number, state: string, text: string) => {
    const run = submissions.get(id)!;
    if (state !== "delta")
      saved.set(id, {
        messages: [
          ...(saved.get(id)?.messages ?? []),
          { id: "answer-" + id, role: "assistant", content: text },
        ],
        sessionInfo: { activeRunIds: [] },
      });
    chatEvent({
      sessionKey: sessionKey(id),
      runId: run.runId,
      seq,
      state,
      message: { role: "assistant", content: text },
    });
  };
  return {
    chat,
    browser,
    gateway,
    request,
    saved,
    submissions,
    publish,
    connected: () => connected(),
    disconnected: () => disconnected(),
    gap: () => gap(),
  };
}

it("runs three conversations through HTTP/SSE, rejects a fourth, and cancels only the selected run", async () => {
  const f = setup();
  await f.browser.refresh();
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) ids.push((await f.browser.create())!);
  const sending: Promise<void>[] = [];
  for (const id of ids.slice(0, 3)) {
    f.browser.select(id);
    await vi.waitFor(() => expect(f.browser.snapshot().views[id]).toBeDefined());
    f.browser.draft(id, "Question " + id);
    sending.push(f.browser.send());
    await vi.waitFor(() => expect(f.browser.snapshot().turns[id]?.phase).toBe("thinking"));
  }
  expect(f.gateway.send).toHaveBeenCalledTimes(3);
  expect(activeTurns(f.browser.snapshot())).toHaveLength(3);
  f.browser.draft(ids[0]!, "Do not send twice");
  f.browser.select(ids[0]!);
  await f.browser.send();
  expect(f.gateway.send).toHaveBeenCalledTimes(3);

  const post = (id: string, requestId: string = crypto.randomUUID()) =>
    f.request("/api/conversations/" + id + "/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId, text: "Question " + id }),
    });
  const duplicate = await post(ids[0]!, f.submissions.get(ids[0]!)!.requestId);
  expect((await duplicate.json()).error.code).toBe("DUPLICATE_REQUEST");
  const busy = await post(ids[0]!);
  expect(busy.status).toBe(409);
  expect((await busy.json()).error.code).toBe("RUN_BUSY");
  const fourth = await post(ids[3]!);
  expect(fourth.status).toBe(409);
  expect((await fourth.json()).error.code).toBe("RUN_LIMIT");
  f.browser.select(ids[3]!);
  await vi.waitFor(() => expect(f.browser.snapshot().views[ids[3]!]).toBeDefined());
  f.browser.draft(ids[3]!, "Fourth question");
  await f.browser.send();
  expect(f.gateway.send).toHaveBeenCalledTimes(3);

  for (const id of ids.slice(0, 3).reverse()) f.publish(id, 1, "delta", "Partial " + id);
  await vi.waitFor(() => {
    for (const id of ids.slice(0, 3)) {
      expect(f.browser.snapshot().turns[id]?.text).toBe("Partial " + id);
      expect(f.browser.snapshot().turns[id]?.activities).toHaveLength(1);
    }
  });
  f.browser.select(ids[1]!);
  await f.browser.cancel();
  expect(f.gateway.cancel).toHaveBeenCalledExactlyOnceWith(
    ids[1],
    f.submissions.get(ids[1]!)!.runId,
  );
  expect(activeTurns(f.browser.snapshot())).toHaveLength(3);
  f.publish(ids[2]!, 2, "final", "Third done");
  await sending[2];
  expect(activeTurns(f.browser.snapshot())).toHaveLength(2);
  expect(f.gateway.unsubscribe).toHaveBeenCalledWith(ids[2]);

  f.browser.select(ids[3]!);
  await vi.waitFor(() => expect(f.browser.snapshot().loading[ids[3]!]).toBe(false));
  sending.push(f.browser.send());
  await vi.waitFor(() => expect(f.gateway.send).toHaveBeenCalledTimes(4));
  f.publish(ids[1]!, 2, "aborted", "Second stopped");
  f.publish(ids[0]!, 2, "final", "First done");
  f.publish(ids[3]!, 1, "final", "Fourth done");
  await Promise.all(sending);
  expect(activeTurns(f.browser.snapshot())).toHaveLength(0);
  expect(f.browser.snapshot().turns[ids[1]!]?.phase).toBe("cancelled");
  expect(f.gateway.send).toHaveBeenCalledTimes(4);
});

it("adopts multiple active conversations and reconciles all runs after gateway loss without resending", async () => {
  const f = setup();
  const ids = Array.from({ length: 3 }, () => crypto.randomUUID());
  for (const id of ids) {
    f.saved.set(id, {
      inFlightRun: { runId: "existing-" + id, text: "Working" },
      sessionInfo: { activeRunIds: ["existing-" + id] },
    });
  }
  f.connected();
  await vi.waitFor(() => expect(f.chat.ready).toBe(true));
  await f.browser.refresh();
  for (const id of ids) await f.browser.loadHistory(id);
  expect(activeTurns(f.browser.snapshot())).toHaveLength(3);
  expect(f.gateway.subscribe).toHaveBeenCalledTimes(3);

  f.gateway.authenticated = false;
  f.disconnected();
  expect(f.chat.ready).toBe(false);
  f.saved.set(ids[0]!, { sessionInfo: { activeRunIds: [] } });
  f.gateway.authenticated = true;
  f.connected();
  await vi.waitFor(() => expect(f.chat.ready).toBe(true));
  // Recover background runs even when a different conversation is selected.
  f.browser.select(ids[2]!);
  await f.browser.refresh(true);
  expect(activeTurns(f.browser.snapshot())).toHaveLength(2);
  expect(f.browser.snapshot().turns[ids[0]!]?.phase).toBe("ended");
  expect(f.gateway.send).not.toHaveBeenCalled();
});

it("does not release an unknown submission when another conversation completes", async () => {
  const f = setup();
  const ids = Array.from({ length: 3 }, () => f.chat.create().id);
  for (const id of ids.slice(0, 2)) await f.chat.send(id, crypto.randomUUID(), "Question");
  f.gateway.send.mockImplementationOnce(async (_id, _requestId, _input, sent) => {
    sent();
    throw new Error("Acknowledgement lost");
  });
  await expect(f.chat.send(ids[2]!, crypto.randomUUID(), "Unknown")).rejects.toMatchObject({
    code: "SUBMISSION_UNKNOWN",
  });
  await vi.waitFor(() =>
    expect(f.gateway.history).toHaveBeenCalledWith(ids[2], 50, 0, expect.any(String)),
  );
  f.publish(ids[0]!, 1, "final", "Done");
  expect(f.chat.ready).toBe(false);
  const history = await f.chat.history(ids[2]!, { limit: 50, offset: 0, emptyOffset: 0 });
  expect(history.activeRun).toMatchObject({ runId: null });
  expect(history.syncState).toBe("uncertain");
  expect(f.gateway.send).toHaveBeenCalledTimes(3);
});
