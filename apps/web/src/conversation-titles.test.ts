import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { GatewayClient } from "@openclaw/gateway-client";
import { expect, it, vi } from "vitest";

import { createApp } from "../../api/src/app.ts";
import { Chat } from "../../api/src/chat.ts";
import { RunTracker } from "../../api/src/chat/runs.ts";
import { legacyNamespace, sessionKey } from "../../api/src/gateway/messages.ts";
import { OpenClaw } from "../../api/src/openclaw.ts";
import type { SessionRow } from "../../api/src/types.ts";

it("uses native naming keys and preserves legacy history, sends, subscriptions, and cancellation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "assessment-titles-"));
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + "assessment-titles-"))
    throw new Error("Unexpected test directory.");

  const oldId = "11111111-1111-4111-8111-111111111111";
  const oldKey = legacyNamespace + oldId;
  const unnamedId = "22222222-2222-4222-8222-222222222222";
  const failedId = "33333333-3333-4333-8333-333333333333";
  const rows: SessionRow[] = [
    {
      key: oldKey,
      label: "Saved custom name",
      displayName: "Automatic name",
      derivedTitle: "Preview",
    },
    { key: legacyNamespace + unnamedId },
    { key: sessionKey(failedId), displayName: "oceanic-crab", derivedTitle: "oceanic-crab" },
  ];
  const request = vi
    .spyOn(GatewayClient.prototype, "request")
    .mockImplementation(async (method, params, options) => {
      const input = params as Record<string, unknown>;
      if (method === "sessions.list")
        return { sessions: rows.filter((row) => row.key.includes(String(input.search))) } as never;
      if (method === "chat.history") {
        if (input.sessionKey === legacyNamespace + unnamedId)
          return {
            totalMessages: 75,
            messages:
              input.offset === 55
                ? [
                    {
                      role: "user",
                      content: [
                        { type: "thinking", text: "Hidden content" },
                        {
                          type: "text",
                          text: "Restore saved conversation titles. Keep history intact.",
                        },
                      ],
                    },
                  ]
                : [{ role: "assistant", content: "A later answer must not become the title." }],
          } as never;
        if (input.sessionKey === sessionKey(failedId))
          return {
            totalMessages: 1,
            messages: [{ role: "user", content: "Plan a garden with native plants." }],
          } as never;
        return { messages: [], sessionInfo: { activeRunIds: [] } } as never;
      }
      if (method === "chat.send") {
        options?.onSent?.("fixture-request");
        if (!rows.some((row) => row.key === input.sessionKey))
          rows.unshift({
            key: String(input.sessionKey),
            displayName: "Plan a garden",
            derivedTitle: "Preview",
          });
        return { runId: "run-" + input.idempotencyKey } as never;
      }
      return {} as never;
    });
  let chat: Chat | undefined;
  let gateway: OpenClaw | undefined;

  try {
    const bootstrap = join(directory, "bootstrap");
    await writeFile(bootstrap, "fixture-token");
    gateway = new OpenClaw(directory, bootstrap);
    gateway.authenticated = true;
    chat = new Chat(gateway);
    chat.ready = true;
    const app = createApp(chat);
    const get = (path: string) =>
      app.request("http://localhost:3000" + path, { headers: { host: "localhost:3000" } });

    // Open an old URL before listing. Discovery must select its original key.
    expect((await get("/api/conversations/" + oldId)).status).toBe(200);
    expect(request).toHaveBeenCalledWith(
      "chat.history",
      expect.objectContaining({ sessionKey: oldKey }),
    );
    await chat.send(oldId, "old-request", "Continue the saved conversation.");
    await chat.cancel(oldId, "run-old-request");
    expect(request).toHaveBeenCalledWith("sessions.messages.subscribe", { key: oldKey });
    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({ sessionKey: oldKey }),
      expect.any(Object),
    );
    expect(request).toHaveBeenCalledWith("chat.abort", {
      sessionKey: oldKey,
      runId: "run-old-request",
    });

    const { id } = chat.create();
    const before = await (await get("/api/conversations")).json();
    expect(before.items.find((item: { id: string }) => item.id === id)).not.toHaveProperty("title");
    const attachments = [
      {
        type: "image" as const,
        mimeType: "image/png" as const,
        fileName: "garden.png",
        content: "iVBORw0KGgo=",
      },
    ];
    await chat.send(id, "new-request", "Help me plan a garden.", attachments);
    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({ sessionKey: sessionKey(id), attachments }),
      expect.any(Object),
    );
    expect(sessionKey(id)).toBe("agent:main:dashboard:assessment-api-" + id);
    const after = await (await get("/api/conversations")).json();
    expect(after.items).toEqual(
      expect.arrayContaining([
        { id, title: "Plan a garden" },
        { id: oldId, title: "Saved custom name" },
        { id: unnamedId, title: "Restore saved conversation titles." },
        { id: failedId, title: "Plan a garden with native plants." },
      ]),
    );
    expect(
      request.mock.calls.filter(
        ([method, input]) =>
          method === "chat.history" &&
          (input as Record<string, unknown>).sessionKey === legacyNamespace + unnamedId,
      ),
    ).toHaveLength(2);
    rows.find((row) => row.key === sessionKey(failedId))!.displayName = "Native garden design";
    const renamed = await (await get("/api/conversations")).json();
    expect(renamed.items.find((item: { id: string }) => item.id === failedId).title).toBe(
      "Native garden design",
    );
    // Roster reads do not request another chat turn or a separate title RPC.
    expect(request.mock.calls.filter(([method]) => method === "chat.send")).toHaveLength(2);
    expect(request.mock.calls.some(([method]) => method === "sessions.title.prepare")).toBe(false);
  } finally {
    chat?.close();
    await gateway?.stop();
    request.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([legacyNamespace, "agent:main:dashboard:assessment-api-"])(
  "routes saved-session events for %s",
  (prefix) => {
    const id = "11111111-1111-4111-8111-111111111111";
    const tracker = new RunTracker({} as OpenClaw, {
      idle: vi.fn(),
      uncertain: vi.fn(),
      recover: vi.fn(),
    });
    const run = tracker.start(id, "request", "hash");
    tracker.accept(run, "run");
    tracker.receive({
      sessionKey: prefix + id,
      runId: "run",
      seq: 1,
      state: "final",
      message: { role: "assistant", content: "Done" },
    });
    expect(run.text).toBe("Done");
    expect(run.done).toBe(true);
    expect(tracker.active.has(id)).toBe(false);
  },
);
