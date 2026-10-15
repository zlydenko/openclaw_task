import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

import { createApp } from "../../api/src/app.ts";
import { Chat } from "../../api/src/chat.ts";
import { readToolEvent } from "../../api/src/gateway/activity.ts";
import { projectMessages, sessionKey } from "../../api/src/gateway/messages.ts";
import type { OpenClaw } from "../../api/src/openclaw.ts";
import type { ChatEvent, ToolEvent } from "../../api/src/types.ts";
import { mergeHistory, groupActivityRows } from "./activity.ts";
import { readEvents } from "./events.ts";
import { ChatController } from "./chat.ts";
import { Activity } from "./components/Activity.tsx";
import { visibleMessages } from "./state.ts";
import type { Message } from "./types.ts";

const disposals: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("streams native tool activity through Hono into React and restores them from history", async () => {
  let chatListener!: (event: ChatEvent) => void;
  let toolListener!: (event: ToolEvent) => void;
  let sequence = 0;
  const rows: unknown[] = [];
  let id = "";
  const gateway = {
    authenticated: true,
    onConnected: vi.fn(),
    onDisconnected: vi.fn(),
    onGap: vi.fn(),
    onEvent: (listener: typeof chatListener) => {
      chatListener = listener;
    },
    onTool: (listener: typeof toolListener) => {
      toolListener = listener;
    },
    subscribe: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => {}),
    roster: vi.fn(async () => ({ sessions: [{ key: sessionKey(id) }] })),
    history: vi.fn(async () => ({ messages: rows })),
    send: vi.fn(async (_id, requestId, input, sent) => {
      sent();
      rows.push({ role: "user", content: input, id: "user" });
      return { runId: "run-1", requestId };
    }),
  };
  const chat = new Chat(gateway as unknown as OpenClaw);
  chat.ready = true;
  const app = createApp(chat);
  const originalFetch = vi.fn((url: string, options?: RequestInit) =>
    app.request(new URL(url, "http://localhost:3000"), {
      ...options,
      headers: { ...options?.headers, host: "localhost:3000" },
    }),
  );
  vi.stubGlobal("fetch", originalFetch);
  const browser = new ChatController();
  disposals.push(() => {
    browser.close();
    chat.close();
  });
  await browser.refresh();
  id = (await browser.create())!;
  browser.select(id);
  await vi.waitFor(() => expect(browser.snapshot().views[id]).toBeDefined());
  await browser.refresh();
  browser.draft(id, "Save a harmless fixture fact.");
  const sending = browser.send();
  await vi.waitFor(() => expect(browser.snapshot().active?.runId).toBe("run-1"));

  const ctx = { runId: "run-1", sessionKey: sessionKey(id), runtime: "openclaw" };
  const publish = (data: object, stream = "tool", key = ctx.sessionKey) => {
    const event = readToolEvent(
      { runId: ctx.runId, sessionKey: key, seq: ++sequence, data },
      stream,
    )!;
    if (event) toolListener(event);
  };
  const params = { input: "*** Begin Patch\n--- a/USER.md\n+++ b/USER.md\n*** End Patch" };
  const first = "functions.apply_patch:0|fc_fixture";
  publish({ phase: "start", name: "apply_patch", toolCallId: first, args: params });
  rows.push({
    role: "assistant",
    content: [
      { type: "thinking", thinking: "PRIVATE_REASONING" },
      { type: "toolCall", id: first, name: "apply_patch", arguments: params },
    ],
  });
  const failed = {
    content: [{ type: "text", text: "Invalid patch hunk at line 2: SECRET_TOOL_OUTPUT" }],
  };
  rows.push({
    role: "toolResult",
    toolCallId: first,
    toolName: "apply_patch",
    ...failed,
    isError: true,
  });
  publish({
    phase: "result",
    name: "apply_patch",
    toolCallId: first,
    result: failed,
    isError: true,
  });
  const other = (await browser.create())!;
  browser.select(other);
  await vi.waitFor(() => expect(browser.snapshot().views[other]).toBeDefined());
  expect(visibleMessages(browser.snapshot().views[other], browser.snapshot().turns[other])).toEqual(
    [],
  );

  const second = "functions.apply_patch:1|fc_fixture";
  const corrected = {
    input: "*** Begin Patch\n*** Update File: USER.md\n@@\n-Before\n+Saved\n*** End Patch",
  };
  publish({ phase: "start", name: "apply_patch", toolCallId: second, args: corrected });
  const succeeded = { content: [{ type: "text", text: "Updated USER.md" }] };
  rows.push({
    role: "assistant",
    content: [{ type: "toolCall", id: second, name: "apply_patch", arguments: corrected }],
  });
  rows.push({
    role: "toolResult",
    toolCallId: second,
    toolName: "apply_patch",
    ...succeeded,
    isError: false,
  });
  publish({
    phase: "result",
    name: "apply_patch",
    toolCallId: second,
    result: succeeded,
    isError: false,
  });
  publish(
    { phase: "start", name: "read", toolCallId: "other", args: { path: "secret_key" } },
    "tool",
    sessionKey("another-conversation"),
  );
  await vi.waitFor(() => expect(browser.snapshot().active?.activities).toHaveLength(2));
  await vi.waitFor(() =>
    expect(browser.snapshot().active?.activities?.map((item) => item.status)).toEqual([
      "failed",
      "completed",
    ]),
  );

  const live = renderToStaticMarkup(
    createElement(Activity, { activities: browser.snapshot().active!.activities! }),
  );
  expect(live).toContain("Failed");
  expect(live).toContain("Completed");
  expect(live).toContain("Invalid patch format");
  expect(live).not.toContain("SECRET_TOOL_OUTPUT");
  rows.push({ role: "assistant", content: "Saved.", id: "final" });
  chatListener({
    sessionKey: ctx.sessionKey,
    runId: ctx.runId,
    seq: 1,
    state: "final",
    message: { role: "assistant", content: "Saved." },
  });
  await sending;
  await vi.waitFor(() =>
    expect(browser.snapshot().views[id]?.messages.at(-1)?.text).toBe("Saved."),
  );
  expect(browser.snapshot().selected).toBe(other);
  const messages = visibleMessages(browser.snapshot().views[id], browser.snapshot().turns[id]);
  const saved = messages.flatMap((item) => item.activities ?? []);
  expect(saved.map((item) => item.status)).toEqual(["failed", "completed"]);
  const serialized = JSON.stringify(messages);
  expect(serialized).not.toContain("PRIVATE_REASONING");
  expect(serialized).not.toContain("SECRET_TOOL_OUTPUT");
  expect(messages.some((item) => item.unsupported)).toBe(false);
  expect(gateway.send).toHaveBeenCalledTimes(1);
  expect(browser.snapshot().active).toBeNull();
});

it("joins calls and outcomes across history pages without empty reasoning rows or unsafe output", () => {
  const id = "functions.read:0|opaque";
  const older = projectMessages([
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "hidden" },
        { type: "toolCall", id, name: "read", arguments: { path: "/private/USER.md" } },
      ],
    },
  ]) as Message[];
  const newer = projectMessages([
    {
      role: "toolResult",
      toolCallId: id,
      toolName: "read",
      isError: false,
      content: [{ type: "text", text: "OPENROUTER_KEY=never expose" }],
    },
    { role: "assistant", content: [{ type: "thinking", thinking: "hidden" }] },
  ]) as Message[];
  const rows = groupActivityRows(mergeHistory(older, newer));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.activities?.[0]).toMatchObject({
    name: "read",
    target: "USER.md",
    status: "completed",
  });
  expect(JSON.stringify(rows)).not.toContain("never expose");
  expect(JSON.stringify(rows)).not.toContain("hidden");
});

it("retains activity when a fast run ends before its send acknowledgement", async () => {
  let chatListener!: (event: ChatEvent) => void;
  let toolListener!: (event: ToolEvent) => void;
  const gateway = {
    authenticated: true,
    onConnected: vi.fn(),
    onDisconnected: vi.fn(),
    onGap: vi.fn(),
    onEvent: (listener: typeof chatListener) => {
      chatListener = listener;
    },
    onTool: (listener: typeof toolListener) => {
      toolListener = listener;
    },
    subscribe: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => {}),
    send: vi.fn(async (id, _requestId, _input, sent) => {
      sent();
      toolListener(
        readToolEvent(
          {
            runId: "early-run",
            seq: 1,
            data: {
              phase: "start",
              toolCallId: "read|opaque",
              name: "read",
              args: { path: "USER.md" },
            },
          },
          "tool",
        )!,
      );
      toolListener(
        readToolEvent(
          {
            runId: "early-run",
            seq: 2,
            data: {
              phase: "result",
              toolCallId: "read|opaque",
              name: "read",
              isError: false,
              result: { content: [{ type: "text", text: "PRIVATE_CONTENT" }] },
            },
          },
          "tool",
        )!,
      );
      chatListener({
        sessionKey: sessionKey(id),
        runId: "early-run",
        seq: 1,
        state: "final",
        message: { role: "assistant", content: "Done" },
      });
      return { runId: "early-run" };
    }),
  };
  const chat = new Chat(gateway as unknown as OpenClaw);
  chat.ready = true;
  disposals.push(() => chat.close());
  const id = chat.create().id;
  const response = await createApp(chat).request(
    "http://localhost:3000/api/conversations/" + id + "/messages",
    {
      method: "POST",
      headers: { host: "localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ requestId: crypto.randomUUID(), text: "Read the fixture" }),
    },
  );
  const events: { event: string; data: { activities?: unknown[] } }[] = [];
  await readEvents(response.body!, (event) => events.push(event));
  expect(events.map((event) => event.event)).toEqual(["accepted", "activity", "completed"]);
  expect(events.at(-1)?.data.activities).toMatchObject([
    { name: "read", status: "completed", target: "USER.md" },
  ]);
  expect(JSON.stringify(events)).not.toContain("PRIVATE_CONTENT");
  expect(gateway.send).toHaveBeenCalledTimes(1);
});
