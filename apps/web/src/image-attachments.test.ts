import { expect, it, vi } from "vitest";

import { createApp } from "../../api/src/app.ts";
import type { Chat } from "../../api/src/chat.ts";
import { RunTracker } from "../../api/src/chat/runs.ts";
import { projectMessages } from "../../api/src/gateway/messages.ts";
import { IMAGE_BYTES_LIMIT, MESSAGE_BODY_LIMIT } from "../../api/src/images.ts";
import type { OpenClaw } from "../../api/src/openclaw.ts";
import type { ImageAttachment, Submission } from "../../api/src/types.ts";

const id = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=",
  "base64",
);
const image = (content = png.toString("base64")): ImageAttachment => ({
  type: "image",
  mimeType: "image/png",
  fileName: "example.png",
  content,
});

it("validates image requests before the chat boundary and streams accepted image-only input", async () => {
  const send = vi.fn(async (conversationId: string, requestId: string): Promise<Submission> => ({
    conversationId,
    requestId,
    runId: "run-image",
    observe(listener) {
      listener({
        event: "completed",
        data: { conversationId, requestId, runId: "run-image", text: "Done" },
      });
      return () => {};
    },
  }));
  const app = createApp({ send } as unknown as Chat);
  const post = (body: unknown, path = "/api/conversations/" + id + "/messages", headers = {}) =>
    app.request("http://localhost:3000" + path, {
      method: "POST",
      headers: { host: "localhost:3000", "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const valid = { requestId, text: "", attachments: [image()] };
  const response = await post(valid);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("event: completed");
  expect(send).toHaveBeenCalledWith(id, requestId, "", [image()]);
  send.mockClear();
  for (const attachments of [
    null,
    {},
    [{ ...image(), mimeType: ["image/png"] }],
    [image("bad=")],
    [{ ...image(), mimeType: "image/svg+xml" }],
    [{ ...image(), fileName: "../secret.png" }],
    [{ ...image(), url: "http://example.com/image.png" }],
    [image(Buffer.from("not an image").toString("base64"))],
  ]) {
    expect((await post({ ...valid, attachments })).status).toBe(400);
  }
  expect((await post({ ...valid, attachments: [] })).status).toBe(400);
  expect((await post({ ...valid, extra: true })).status).toBe(400);
  expect((await post({ ...valid, text: "a".repeat(8193) })).status).toBe(413);
  expect(
    (await post({ ...valid, attachments: Array.from({ length: 5 }, () => image()) })).status,
  ).toBe(413);
  const large = Buffer.alloc(IMAGE_BYTES_LIMIT + 1);
  png.copy(large);
  expect((await post({ ...valid, attachments: [image(large.toString("base64"))] })).status).toBe(
    413,
  );
  expect((await post(" ".repeat(MESSAGE_BODY_LIMIT + 1))).status).toBe(413);
  expect((await post(" ".repeat(16385), "/api/conversations")).status).toBe(413);
  expect((await post(valid, undefined, { origin: "https://untrusted.example" })).status).toBe(400);
  expect(send).not.toHaveBeenCalled();
});

it("includes image bytes, order, and names in request identity without retaining image payloads", () => {
  const runs = new RunTracker({} as OpenClaw, {
    idle: () => {},
    uncertain: () => {},
    recover: () => {},
  });
  const hash = runs.checkSubmission(id, requestId, "", [image()]);
  expect(runs.checkSubmission(id, requestId, "", [{ ...image(), content: "different" }])).not.toBe(
    hash,
  );
  expect(
    runs.checkSubmission(id, requestId, "", [{ ...image(), fileName: "different.png" }]),
  ).not.toBe(hash);
  const other = { ...image(), fileName: "second.png" };
  expect(runs.checkSubmission(id, requestId, "", [image(), other])).not.toBe(
    runs.checkSubmission(id, requestId, "", [other, image()]),
  );
  const run = runs.start(id, requestId, hash);
  expect(JSON.stringify(run)).not.toContain(image().content);
  expect(() => runs.checkSubmission(id, requestId, "", [image()])).toThrowError(
    /already submitted/,
  );
  expect(() => runs.checkSubmission(id, requestId, "", [other])).toThrowError(/new request ID/);
});

it("restores native retained image labels without exposing bytes, local paths, or private blocks", () => {
  const projected = projectMessages([
    {
      role: "user",
      content: "What is here?",
      __openclaw: {
        id: "saved",
        media: [
          {
            url: "media://inbound/private-id",
            contentType: "image/png",
            kind: "image",
            fileName: "example.png",
          },
        ],
      },
    },
    {
      role: "user",
      content: [
        { type: "image", data: image().content, mimeType: "image/png", fileName: "inline.png" },
      ],
    },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private" },
        { type: "text", text: "An image." },
      ],
    },
  ]);
  expect(projected[0]?.images).toEqual([{ fileName: "example.png" }]);
  expect(projected[1]).toMatchObject({
    text: "",
    images: [{ fileName: "inline.png" }],
    unsupported: false,
  });
  expect(JSON.stringify(projected)).not.toContain(image().content);
  expect(JSON.stringify(projected)).not.toContain("private");
});

it("bounds attachment labels and text together in history responses", () => {
  const messages = Array.from({ length: 100 }, (_, index) => ({
    id: String(index),
    role: "user",
    content: "a".repeat(8192),
    __openclaw: {
      media: Array.from({ length: 4 }, () => ({ kind: "image", fileName: "\u0000".repeat(200) })),
    },
  }));
  const projected = projectMessages(messages);
  expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThan(512 * 1024);
  expect(projected.some((message) => message.truncated)).toBe(true);
});
