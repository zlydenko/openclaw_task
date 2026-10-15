import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatController } from "./chat.ts";
import { visibleMessages } from "./state.ts";
import type { History, StreamEvent } from "./types.ts";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const histories = new Map<string, History>();
let controller: ChatController;
let stream: ReadableStreamDefaultController<Uint8Array>;
let requestId: string;
let sends: number;
let cancels: number;
let rejection: { status: number; code: string; outcomeUnknown?: boolean } | null;

const empty = (id: string): History => ({
  id,
  messages: [],
  nextCursor: null,
  activeRun: null,
  syncState: "ready",
});

function frame(event: StreamEvent["event"], extra: object = {}, conversationId = first) {
  const bytes = new TextEncoder().encode(
    `event: ${event}\r\ndata: ${JSON.stringify({
      conversationId,
      requestId,
      runId: "run-1",
      ...extra,
    })}\r\n\r\n`,
  );

  // Real network chunks need not end at lines or UTF-8 boundaries.
  for (let offset = 0; offset < bytes.length; offset += 7)
    stream.enqueue(bytes.slice(offset, offset + 7));
}

async function select(id = first) {
  controller.select(id);
  await vi.waitFor(() => expect(controller.snapshot().views[id]).toBeDefined());
}

beforeEach(async () => {
  histories.clear();
  histories.set(first, empty(first));
  histories.set(second, empty(second));
  sends = 0;
  cancels = 0;
  rejection = null;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      const path = new URL(url, "http://localhost:3000").pathname;

      if (path === "/ready") return Response.json({ status: "ready" });
      if (path === "/api/conversations")
        return Response.json({ items: [{ id: first }, { id: second }], nextCursor: null });
      if (path.endsWith("/cancel")) {
        cancels++;
        return Response.json({ cancellationRequested: true }, { status: 202 });
      }
      if (path.endsWith("/messages")) {
        sends++;
        requestId = JSON.parse(options!.body as string).requestId;

        if (rejection)
          return Response.json(
            { error: { ...rejection, message: "Submission rejected or unknown." } },
            { status: rejection.status },
          );

        return new Response(
          new ReadableStream<Uint8Array>({
            start(value) {
              stream = value;
            },
          }),
          {
            headers: { "Content-Type": "text/event-stream" },
          },
        );
      }

      const id = path.split("/").at(-1)!;
      return Response.json(structuredClone(histories.get(id)));
    }),
  );

  controller = new ChatController();
  await controller.refresh();
  await select();
});

afterEach(() => {
  controller.close();
  vi.unstubAllGlobals();
});

describe("chat HTTP and stream integration", () => {
  it("replaces fragmented Unicode snapshots, isolates navigation, and submits once", async () => {
    controller.draft(first, "Say hello\n");
    const pending = controller.send();
    await vi.waitFor(() => expect(sends).toBe(1));
    frame("accepted");
    await vi.waitFor(() => expect(controller.snapshot().active?.phase).toBe("thinking"));
    expect(controller.snapshot().drafts[first]).toBe("");

    stream.enqueue(new TextEncoder().encode(": heartbeat\r\n\r\n"));
    frame("message", { text: "Wrong conversation" }, second);
    frame("message", { text: "Hello" });
    frame("message", { text: "Hello 🌒" });
    await vi.waitFor(() => expect(controller.snapshot().turns[first]?.text).toBe("Hello 🌒"));
    await select(second);
    controller.draft(second, "Another question");
    await controller.send();
    expect(sends).toBe(1);
    expect(
      visibleMessages(controller.snapshot().views[second], controller.snapshot().turns[second]),
    ).toEqual([]);

    histories.set(first, {
      ...empty(first),
      messages: [
        { id: "user-1", role: "user", text: "Say hello" },
        { id: "assistant-1", role: "assistant", text: "Hello 🌒" },
      ],
    });
    frame("completed", { text: "Hello 🌒" });
    stream.close();
    await pending;
    await vi.waitFor(() => expect(controller.snapshot().views[first]?.messages).toHaveLength(2));

    const state = controller.snapshot();
    expect(state.active).toBeNull();
    expect(state.selected).toBe(second);
    expect(
      visibleMessages(state.views[first], state.turns[first]).map((message) => message.text),
    ).toEqual(["Say hello", "Hello 🌒"]);
  });

  it("keeps cancellation pending until the confirmed completion wins the race", async () => {
    controller.draft(first, "A short answer");
    const pending = controller.send();
    await vi.waitFor(() => expect(sends).toBe(1));
    frame("accepted");
    frame("message", { text: "Partial" });
    await vi.waitFor(() => expect(controller.snapshot().active?.text).toBe("Partial"));
    await controller.cancel();
    expect(cancels).toBe(1);
    expect(controller.snapshot().active?.phase).toBe("stopping");
    await controller.send();
    expect(sends).toBe(1);

    frame("completed", { text: "Complete answer" });
    stream.close();
    await pending;
    expect(controller.snapshot().turns[first]?.phase).toBe("completed");
    expect(controller.snapshot().turns[first]?.text).toBe("Complete answer");
    expect(controller.snapshot().active).toBeNull();
  });

  it("recovers a lost stream through reads without retrying the message", async () => {
    controller.draft(first, "Work on this");
    const pending = controller.send();
    await vi.waitFor(() => expect(sends).toBe(1));
    frame("accepted");
    frame("message", { text: "Still working" });
    histories.set(first, {
      ...empty(first),
      activeRun: { runId: "run-1", requestId },
      syncState: "uncertain",
    });
    stream.close();
    await pending;
    await vi.waitFor(() => expect(controller.snapshot().views[first]?.syncState).toBe("uncertain"));
    expect(controller.snapshot().active?.phase).toBe("checking");
    controller.draft(first, "Do not submit this yet");
    await controller.send();
    expect(sends).toBe(1);

    histories.set(first, {
      ...empty(first),
      activeRun: { runId: "another-run", requestId: "another-request" },
    });
    await controller.refresh(true);
    expect(controller.snapshot().active?.runId).toBe("run-1");
    expect(controller.snapshot().active?.notice).toContain("Another run is active");

    histories.set(first, empty(first));
    await controller.refresh(true);
    expect(controller.snapshot().active).toBeNull();
    expect(controller.snapshot().turns[first]?.phase).toBe("ended");
    expect(controller.snapshot().turns[first]?.text).toBe("Still working");
    expect(sends).toBe(1);
  });

  it("retains drafts on a definitive rejection and does not automatically retry", async () => {
    rejection = { status: 409, code: "RUN_BUSY" };
    controller.draft(first, "Keep my draft");
    await controller.send();
    await controller.refresh(true);
    expect(sends).toBe(1);
    expect(controller.snapshot().drafts[first]).toBe("Keep my draft");
    expect(controller.snapshot().turns[first]?.phase).toBe("failed");
    expect(controller.snapshot().active).toBeNull();
  });

  it("blocks an unknown acknowledgement until the server resolves it", async () => {
    rejection = { status: 503, code: "SUBMISSION_UNKNOWN", outcomeUnknown: true };
    histories.set(first, { ...empty(first), syncState: "uncertain" });
    controller.draft(first, "Possibly accepted");
    await controller.send();
    await vi.waitFor(() => expect(controller.snapshot().views[first]?.syncState).toBe("uncertain"));
    await controller.send();
    expect(sends).toBe(1);
    expect(controller.snapshot().active?.phase).toBe("checking");
    expect(controller.snapshot().drafts[first]).toBe("Possibly accepted");
  });

  it("adopts a run after refresh without issuing a send", async () => {
    histories.set(first, {
      ...empty(first),
      activeRun: { runId: "existing-run", requestId: null },
    });
    await controller.refresh(true);
    expect(controller.snapshot().active?.runId).toBe("existing-run");
    expect(controller.snapshot().active?.phase).toBe("checking");
    await controller.cancel();
    await controller.refresh(true);
    expect(controller.snapshot().active?.phase).toBe("stopping");
    expect(cancels).toBe(1);
    await select(second);
    controller.draft(second, "Blocked while another conversation runs");
    await controller.send();
    expect(sends).toBe(0);
  });

  it("discards history captured before a newer stream update", async () => {
    controller.draft(first, "Keep the newest response");
    const pending = controller.send();
    await vi.waitFor(() => expect(sends).toBe(1));
    frame("accepted");
    await vi.waitFor(() => expect(controller.snapshot().active?.phase).toBe("thinking"));

    let resolveRead!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveRead = resolve;
    });
    vi.mocked(fetch).mockImplementationOnce(() => response);
    const reading = controller.loadHistory(first);
    frame("message", { text: "The current snapshot" });
    await vi.waitFor(() => expect(controller.snapshot().active?.text).toBe("The current snapshot"));
    resolveRead(
      Response.json({
        ...empty(first),
        messages: [{ id: "stale", role: "assistant", text: "Stale snapshot" }],
      }),
    );
    await reading;

    expect(controller.snapshot().views[first]?.messages).toEqual([]);
    expect(controller.snapshot().active?.text).toBe("The current snapshot");
    frame("completed", { text: "The current snapshot" });
    stream.close();
    await pending;
  });

  it("reads recovery state even while gateway readiness returns 503", async () => {
    histories.set(first, {
      ...empty(first),
      activeRun: { runId: "recovering-run", requestId: null },
      syncState: "uncertain",
    });
    vi.mocked(fetch).mockImplementationOnce(async () =>
      Response.json({ status: "unavailable", reason: "RECOVERING" }, { status: 503 }),
    );
    await controller.refresh(true);

    expect(controller.snapshot().ready).toBe(false);
    expect(controller.snapshot().connection).toBe("Synchronizing…");
    expect(controller.snapshot().active?.runId).toBe("recovering-run");
    expect(sends).toBe(0);
  });

  it("loads older history through the opaque cursor without duplicate rows", async () => {
    histories.set(first, {
      ...empty(first),
      nextCursor: "opaque+/=",
      messages: [{ id: "recent", role: "assistant", text: "Recent answer" }],
    });
    await controller.loadHistory(first);
    vi.mocked(fetch).mockImplementationOnce(async () =>
      Response.json({
        ...empty(first),
        messages: [
          { id: "older", role: "user", text: "Earlier question" },
          { id: "recent", role: "assistant", text: "Older snapshot" },
        ],
      }),
    );
    await controller.loadHistory(first, true);

    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toContain("cursor=opaque%2B%2F%3D");
    expect(controller.snapshot().views[first]?.messages.map((message) => message.text)).toEqual([
      "Earlier question",
      "Recent answer",
    ]);
    expect(controller.snapshot().views[first]?.nextCursor).toBeNull();
    expect(sends).toBe(0);
  });
});
