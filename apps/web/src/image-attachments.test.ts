import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { GatewayClient } from "@openclaw/gateway-client";
import { expect, it, vi } from "vitest";

import { createApp } from "../../api/src/app.ts";
import { Chat } from "../../api/src/chat.ts";
import { RunTracker } from "../../api/src/chat/runs.ts";
import { readGatewayImage } from "../../api/src/gateway/images.ts";
import { sessionKey, projectMessages } from "../../api/src/gateway/messages.ts";
import { IMAGE_BYTES_LIMIT, MESSAGE_BODY_LIMIT } from "../../api/src/images.ts";
import { OpenClaw } from "../../api/src/openclaw.ts";
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

it("reloads saved previews through exact native messages and authenticated media without sending", async () => {
  const directory = await mkdtemp(join(tmpdir(), "assessment-image-preview-"));
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + "assessment-image-preview-"))
    throw new Error("Unexpected test directory.");
  const otherId = "33333333-3333-4333-8333-333333333333";
  const source = "media://inbound/example---saved.png";
  const messageId = "saved-message";
  const message = {
    role: "user",
    content: "What is here?",
    __openclaw: {
      id: messageId,
      media: [{ url: source, contentType: "image/png", kind: "image", fileName: "example.png" }],
    },
  };
  const request = vi
    .spyOn(GatewayClient.prototype, "request")
    .mockImplementation(async (method, params) => {
      const input = params as Record<string, unknown>;
      if (method === "sessions.list")
        return { sessions: [{ key: sessionKey(id) }, { key: sessionKey(otherId) }] } as never;
      if (method === "chat.history") return { messages: [message] } as never;
      if (method === "chat.message.get")
        return {
          ok: input.sessionKey === sessionKey(id) && input.messageId === messageId,
          message:
            input.sessionKey === sessionKey(id) && input.messageId === messageId
              ? message
              : undefined,
        } as never;
      throw new Error("Unexpected native request.");
    });
  const fetchImage = vi.fn(
    async () =>
      new Response(png, {
        headers: { "content-type": "image/png", "set-cookie": "gateway-private-cookie=private" },
      }),
  );
  vi.stubGlobal("fetch", fetchImage);
  let chat: Chat | undefined;
  try {
    await writeFile(join(directory, "bootstrap"), "test-bootstrap");
    await writeFile(join(directory, "token.json"), JSON.stringify({ token: "test-device-token" }));
    const gateway = new OpenClaw(directory, join(directory, "bootstrap"));
    gateway.authenticated = true;
    chat = new Chat(gateway);
    chat.ready = true;
    const app = createApp(chat);
    const get = (path: string) =>
      app.request("http://localhost:3000" + path, { headers: { host: "localhost:3000" } });
    const history = await (await get("/api/conversations/" + id)).json();
    const preview = history.messages[0].images[0].url;
    expect(preview).toBe("/api/conversations/" + id + "/images/" + messageId + "/0");
    expect(JSON.stringify(history)).not.toContain("media://");
    const first = await get(preview);
    expect(first.status).toBe(200);
    expect(Buffer.from(await first.arrayBuffer())).toEqual(png);
    expect(first.headers.get("content-type")).toBe("image/png");
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("set-cookie")).toBeNull();
    const [url, options] = fetchImage.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/__openclaw__/assistant-media");
    expect(url.searchParams.get("sessionKey")).toBe(sessionKey(id));
    expect(url.searchParams.get("source")).toBe(source);
    expect(url.searchParams.has("token")).toBe(false);
    expect(options.headers).toEqual({ Authorization: "Bearer test-device-token" });
    expect(options.redirect).toBe("error");
    // Rotated device credentials are read afresh. No signed URL or token is cached in history.
    await writeFile(join(directory, "token.json"), JSON.stringify({ token: "rotated-test-token" }));
    const reloaded = await (await get("/api/conversations/" + id)).json();
    expect(reloaded.messages[0].images[0].url).toBe(preview);
    expect((await get(preview)).status).toBe(200);
    expect((fetchImage.mock.calls[1] as unknown as [URL, RequestInit])[1].headers).toEqual({
      Authorization: "Bearer rotated-test-token",
    });
    fetchImage.mockClear();
    for (const path of [
      preview.replace(id, otherId),
      preview.replace(messageId, "missing-message"),
      preview.replace("/0", "/4"),
      preview.replace(messageId, "..%2Fsecret"),
    ])
      expect((await get(path)).status).toBe(404);
    expect(fetchImage).not.toHaveBeenCalled();
    expect(request.mock.calls.some(([method]) => method === "chat.send")).toBe(false);
    expect(request).toHaveBeenCalledWith("chat.message.get", {
      sessionKey: sessionKey(id),
      messageId,
      maxChars: 480 * 1024,
    });
  } finally {
    chat?.close();
    request.mockRestore();
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  }
});

it("rejects unsafe image sources and bounds native media reads, including chunked bodies", async () => {
  const readImage = () =>
    readGatewayImage(
      new URL("http://gateway:18789"),
      "private-token",
      sessionKey(id),
      "media://inbound/image.png",
    );
  const fetchImage = vi.fn();
  vi.stubGlobal("fetch", fetchImage);
  try {
    await expect(
      readGatewayImage(
        new URL("http://gateway:18789"),
        "private-token",
        sessionKey(id),
        "http://untrusted/image.png",
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(fetchImage).not.toHaveBeenCalled();
    fetchImage.mockResolvedValueOnce(new Response("private upstream error", { status: 403 }));
    await expect(readImage()).rejects.toMatchObject({
      status: 503,
      message: "The image could not be loaded.",
    });
    fetchImage.mockResolvedValueOnce(
      new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }),
    );
    await expect(readImage()).rejects.toMatchObject({ status: 404 });
    fetchImage.mockResolvedValueOnce(
      new Response(png, {
        headers: { "content-type": "image/png", "content-length": String(IMAGE_BYTES_LIMIT + 1) },
      }),
    );
    await expect(readImage()).rejects.toMatchObject({ status: 413 });
    fetchImage.mockResolvedValueOnce(
      new Response(new Uint8Array(IMAGE_BYTES_LIMIT + 1), {
        headers: { "content-type": "image/png" },
      }),
    );
    await expect(readImage()).rejects.toMatchObject({ status: 413 });
    fetchImage.mockRejectedValueOnce(new Error("private network details"));
    await expect(readImage()).rejects.toMatchObject({
      status: 503,
      message: "The image could not be loaded.",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
