import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatController } from "./chat.ts";
import { activeTurns, visibleMessages } from "./state.ts";
import type { History, StreamEvent } from "./types.ts";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const histories = new Map<string, History>();
let controller: ChatController;
let stream: ReadableStreamDefaultController<Uint8Array>;
let requestId: string;
let sentBody: Record<string, unknown>;
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
  await vi.waitFor(() => {
    expect(controller.snapshot().views[id]).toBeDefined();
    expect(controller.snapshot().loading[id]).toBe(false);
  });
}

beforeEach(async () => {
  histories.clear();
  histories.set(first, empty(first));
  histories.set(second, empty(second));
  sends = 0;
  cancels = 0;
  rejection = null;
  vi.stubGlobal(
    "FileReader",
    class {
      result = "";
      onload?: () => void;
      onerror?: () => void;
      readAsDataURL(file: File) {
        void file
          .arrayBuffer()
          .then((bytes) => {
            this.result = "data:" + file.type + ";base64," + Buffer.from(bytes).toString("base64");
            this.onload?.();
          })
          .catch(() => this.onerror?.());
      }
    },
  );

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
        sentBody = JSON.parse(options!.body as string);
        requestId = sentBody.requestId as string;

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
    await vi.waitFor(() => expect(controller.snapshot().turns[first]?.phase).toBe("thinking"));
    expect(controller.snapshot().drafts[first]).toBe("");

    stream.enqueue(new TextEncoder().encode(": heartbeat\r\n\r\n"));
    frame("message", { text: "Wrong conversation" }, second);
    frame("message", { text: "Hello" });
    frame("message", { text: "Hello 🌒" });
    await vi.waitFor(() => expect(controller.snapshot().turns[first]?.text).toBe("Hello 🌒"));
    await select(second);
    controller.draft(second, "Another question");
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
    expect(activeTurns(state)).toHaveLength(0);
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
    await vi.waitFor(() => expect(controller.snapshot().turns[first]?.text).toBe("Partial"));
    await controller.cancel();
    expect(cancels).toBe(1);
    expect(controller.snapshot().turns[first]?.phase).toBe("stopping");
    await controller.send();
    expect(sends).toBe(1);

    frame("completed", { text: "Complete answer" });
    stream.close();
    await pending;
    expect(controller.snapshot().turns[first]?.phase).toBe("completed");
    expect(controller.snapshot().turns[first]?.text).toBe("Complete answer");
    expect(activeTurns(controller.snapshot())).toHaveLength(0);
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
    expect(controller.snapshot().turns[first]?.phase).toBe("checking");
    controller.draft(first, "Do not submit this yet");
    await controller.send();
    expect(sends).toBe(1);

    histories.set(first, {
      ...empty(first),
      activeRun: { runId: "another-run", requestId: "another-request" },
    });
    await controller.refresh(true);
    expect(controller.snapshot().turns[first]?.runId).toBe("run-1");
    expect(controller.snapshot().turns[first]?.notice).toContain("Another run is active");

    histories.set(first, empty(first));
    await controller.refresh(true);
    expect(activeTurns(controller.snapshot())).toHaveLength(0);
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
    expect(activeTurns(controller.snapshot())).toHaveLength(0);
  });

  it("recovers a lost background stream while another conversation keeps streaming", async () => {
    controller.draft(first, "First question");
    const firstPending = controller.send();
    await vi.waitFor(() => expect(sends).toBe(1));
    frame("accepted");
    frame("message", { text: "First partial" });
    const firstStream = stream;
    const firstRequest = requestId;
    await select(second);
    controller.draft(second, "Second question");
    const secondPending = controller.send();
    await vi.waitFor(() => expect(sends).toBe(2));
    frame("accepted", { runId: "run-2" }, second);
    await vi.waitFor(() => expect(controller.snapshot().turns[second]?.phase).toBe("thinking"));
    histories.set(first, {
      ...empty(first),
      activeRun: { runId: "run-1", requestId: firstRequest },
      syncState: "uncertain",
    });
    firstStream.close();
    await firstPending;
    await vi.waitFor(() => expect(controller.snapshot().turns[first]?.phase).toBe("checking"));
    histories.set(first, empty(first));
    await controller.refresh(true);
    expect(controller.snapshot().turns[first]?.phase).toBe("ended");
    expect(controller.snapshot().turns[first]?.text).toBe("First partial");
    expect(controller.snapshot().turns[second]?.phase).toBe("thinking");
    expect(sends).toBe(2);
    frame("completed", { runId: "run-2", text: "Second done" }, second);
    await secondPending;
  });

  it("blocks an unknown acknowledgement until the server resolves it", async () => {
    rejection = { status: 503, code: "SUBMISSION_UNKNOWN", outcomeUnknown: true };
    histories.set(first, { ...empty(first), syncState: "uncertain" });
    controller.draft(first, "Possibly accepted");
    await controller.send();
    await vi.waitFor(() => expect(controller.snapshot().views[first]?.syncState).toBe("uncertain"));
    await controller.send();
    expect(sends).toBe(1);
    expect(controller.snapshot().turns[first]?.phase).toBe("checking");
    expect(controller.snapshot().drafts[first]).toBe("Possibly accepted");
  });

  it("adopts a run after refresh without issuing a send", async () => {
    histories.set(first, {
      ...empty(first),
      activeRun: { runId: "existing-run", requestId: null },
    });
    await controller.refresh(true);
    expect(controller.snapshot().turns[first]?.runId).toBe("existing-run");
    expect(controller.snapshot().turns[first]?.phase).toBe("checking");
    await controller.cancel();
    await controller.refresh(true);
    expect(controller.snapshot().turns[first]?.phase).toBe("stopping");
    expect(cancels).toBe(1);
    await select(second);
    controller.draft(second, "Work in parallel");
    const pending = controller.send();
    await vi.waitFor(() => expect(sends).toBe(1));
    frame("accepted", {}, second);
    frame("completed", { text: "Done" }, second);
    await pending;
    expect(controller.snapshot().turns[first]?.phase).toBe("stopping");
    expect(controller.snapshot().turns[second]?.phase).toBe("completed");
  });

  it("discards history captured before a newer stream update", async () => {
    controller.draft(first, "Keep the newest response");
    const pending = controller.send();
    await vi.waitFor(() => expect(sends).toBe(1));
    frame("accepted");
    await vi.waitFor(() => expect(controller.snapshot().turns[first]?.phase).toBe("thinking"));

    let resolveRead!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveRead = resolve;
    });
    vi.mocked(fetch).mockImplementationOnce(() => response);
    const reading = controller.loadHistory(first);
    frame("message", { text: "The current snapshot" });
    await vi.waitFor(() =>
      expect(controller.snapshot().turns[first]?.text).toBe("The current snapshot"),
    );
    resolveRead(
      Response.json({
        ...empty(first),
        messages: [{ id: "stale", role: "assistant", text: "Stale snapshot" }],
      }),
    );
    await reading;

    expect(controller.snapshot().views[first]?.messages).toEqual([]);
    expect(controller.snapshot().turns[first]?.text).toBe("The current snapshot");
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
    expect(controller.snapshot().turns[first]?.runId).toBe("recovering-run");
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

it("refreshes delayed titles after navigation and retains loaded list pages without resending", async () => {
  await select(second);
  vi.mocked(fetch).mockImplementationOnce(async () =>
    Response.json({
      items: [{ id: first }, { id: second }],
      nextCursor: "older-page",
    }),
  );
  await controller.loadList();
  vi.mocked(fetch).mockImplementationOnce(async () =>
    Response.json({
      items: [{ id: "older", title: "Older conversation" }],
      nextCursor: "last-page",
    }),
  );
  await controller.loadList(true);
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (
      new URL(url instanceof Request ? url.url : url, "http://localhost:3000").pathname ===
      "/api/conversations"
    )
      return Response.json({
        items: [{ id: first, title: "Plan a garden" }, { id: second }],
        nextCursor: "older-page",
      });
    return originalFetch(url, options);
  });
  await controller.refresh();
  expect(controller.snapshot().items).toEqual([
    { id: first, title: "Plan a garden" },
    { id: second },
    { id: "older", title: "Older conversation" },
  ]);
  expect(controller.snapshot().nextCursor).toBe("last-page");
  expect(controller.snapshot().selected).toBe(second);
  expect(sends).toBe(0);
});

const imageFile = (name = "example.png") =>
  new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: "image/png" });

it("sends an image-only message once, isolates drafts, and reconciles saved attachment labels", async () => {
  await controller.attach(first, [imageFile()]);
  const image = controller.snapshot().attachments[first]![0]!;
  await select(second);
  expect(controller.snapshot().attachments[second]).toBeUndefined();
  expect(controller.snapshot().attachments[first]).toHaveLength(1);
  await select(first);
  const pending = controller.send();
  await vi.waitFor(() => expect(sends).toBe(1));
  expect(sentBody.text).toBe("");
  expect(sentBody.attachments).toEqual([
    { type: "image", mimeType: "image/png", fileName: "example.png", content: image.content },
  ]);
  expect(
    visibleMessages(controller.snapshot().views[first], controller.snapshot().turns[first])[0]
      ?.images?.[0]?.url,
  ).toContain("data:image/png;base64,");

  // A new selection while acceptance is pending must survive that acknowledgement.
  await controller.attach(first, [imageFile("next.png")]);
  frame("accepted");
  await vi.waitFor(() => expect(controller.snapshot().turns[first]?.phase).toBe("thinking"));
  expect(controller.snapshot().attachments[first]?.map((item) => item.fileName)).toEqual([
    "next.png",
  ]);
  await select(second);
  histories.set(first, {
    ...empty(first),
    messages: [
      {
        id: "saved-image",
        role: "user",
        text: "",
        images: [
          { fileName: "example.png", url: "/api/conversations/" + first + "/images/saved-image/0" },
        ],
      },
      { id: "saved-answer", role: "assistant", text: "An image." },
    ],
  });
  frame("completed", { text: "An image." });
  stream.close();
  await pending;
  await vi.waitFor(() => expect(controller.snapshot().views[first]?.messages).toHaveLength(2));
  const state = controller.snapshot();
  expect(visibleMessages(state.views[first], state.turns[first])).toHaveLength(2);
  expect(state.selected).toBe(second);
  await select(first);
  expect(
    visibleMessages(controller.snapshot().views[first], controller.snapshot().turns[first])[0]
      ?.images?.[0]?.url,
  ).toBe("/api/conversations/" + first + "/images/saved-image/0");
  controller.close();
  controller = new ChatController();
  await controller.refresh();
  await select(first);
  expect(visibleMessages(controller.snapshot().views[first])[0]?.images?.[0]?.url).toBe(
    "/api/conversations/" + first + "/images/saved-image/0",
  );
  expect(sends).toBe(1);
});

it("keeps image drafts on rejection and blocks invalid images before HTTP submission", async () => {
  await controller.attach(first, [new File(["pdf"], "document.pdf", { type: "application/pdf" })]);
  expect(controller.snapshot().imageErrors[first]).toContain("PNG");
  await controller.attach(first, [
    new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
  ]);
  expect(controller.snapshot().imageErrors[first]).toContain("5 MiB");
  expect(sends).toBe(0);
  await controller.attach(first, [imageFile()]);
  await controller.attach(
    first,
    Array.from({ length: 4 }, () => imageFile()),
  );
  expect(controller.snapshot().imageErrors[first]).toContain("4 images");
  expect(controller.snapshot().attachments[first]).toHaveLength(1);
  rejection = { status: 413, code: "IMAGE_LIMIT" };
  await controller.send();
  await controller.refresh(true);
  expect(controller.snapshot().attachments[first]).toHaveLength(1);
  expect(controller.snapshot().turns[first]?.phase).toBe("failed");
  expect(sends).toBe(1);
  controller.removeImage(first, controller.snapshot().attachments[first]![0]!.id);
  await controller.send();
  expect(sends).toBe(1);
});

it("keeps unknown image submissions locked without repeating the POST", async () => {
  await controller.attach(first, [imageFile()]);
  rejection = { status: 503, code: "SUBMISSION_UNKNOWN", outcomeUnknown: true };
  histories.set(first, { ...empty(first), syncState: "uncertain" });
  await controller.send();
  await controller.refresh(true);
  await controller.send();
  expect(controller.snapshot().turns[first]?.phase).toBe("checking");
  expect(controller.snapshot().attachments[first]).toHaveLength(1);
  expect(sends).toBe(1);
});
