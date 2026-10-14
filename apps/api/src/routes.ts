import { streamSSE } from "hono/streaming";
import type { Hono } from "hono";
import { ApiError, Chat, pageFrom, type StreamEvent } from "./chat.ts";
import { uuid } from "./openclaw.ts";

export type ApiEnv = { Variables: { body: Record<string, unknown> } };

export function registerRoutes(app: Hono<ApiEnv>, chat: Chat) {
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/ready", (c) =>
    c.json(
      chat.ready ? { status: "ready" } : { status: "unavailable", reason: chat.reason },
      chat.ready ? 200 : 503,
    ),
  );
  app.post("/api/conversations", (c) => {
    const body = c.get("body");
    if (Object.keys(body).length)
      throw new ApiError(400, "INVALID_INPUT", "Use an empty JSON object.");
    return c.json(chat.create(), 201);
  });
  app.get("/api/conversations", async (c) =>
    c.json(await chat.list(pageFrom(c.req.query("limit"), c.req.query("cursor")))),
  );
  app.get("/api/conversations/:id", async (c) => {
    const id = c.req.param("id");
    return c.json(
      await chat.history(id, pageFrom(c.req.query("limit"), c.req.query("cursor"), id)),
    );
  });
  app.post("/api/conversations/:id/messages", async (c) => {
    const body = c.get("body");
    if (
      Object.keys(body).some((key) => key !== "requestId" && key !== "text") ||
      typeof body.requestId !== "string" ||
      !uuid.test(body.requestId) ||
      typeof body.text !== "string" ||
      !body.text.trim()
    )
      throw new ApiError(400, "INVALID_INPUT", "Use a UUID requestId and non-empty text.");
    if (Buffer.byteLength(body.text) > 8192)
      throw new ApiError(413, "TEXT_LIMIT", "Message text must not exceed 8 KiB.");
    const run = await chat.send(c.req.param("id"), body.requestId.toLowerCase(), body.text);
    c.header("Cache-Control", "no-store");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      let closed = false;
      let wake: (() => void) | undefined;
      let pending: StreamEvent | undefined;
      let terminal: StreamEvent | undefined;
      const detach = run.observe((event) => {
        if (event.event === "message") pending = event;
        else terminal ??= event;
        wake?.();
      });
      const close = () => {
        closed = true;
        detach();
        wake?.();
      };
      stream.onAbort(close);
      const deadline = setTimeout(() => {
        terminal ??= {
          event: "failed",
          data: {
            conversationId: run.conversationId,
            requestId: run.requestId,
            runId: run.runId,
            code: "OBSERVATION_TIMEOUT",
            message: "Observation timed out. Read history. The run may still be active.",
            outcomeUnknown: true,
          },
        };
        wake?.();
      }, 200_000);
      const write = async (event: StreamEvent) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            stream.writeSSE({ event: event.event, data: JSON.stringify(event.data) }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("Slow stream")), 2000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      };
      const heartbeat = setInterval(() => {
        wake?.();
      }, 15_000);
      try {
        await write({
          event: "accepted",
          data: { conversationId: run.conversationId, requestId: run.requestId, runId: run.runId },
        });
        while (!closed) {
          if (terminal) {
            await write(terminal);
            break;
          }
          if (pending) {
            const event = pending;
            pending = undefined;
            await write(event);
            continue;
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = undefined;
          if (!closed && !pending && !terminal) {
            // Use the same bounded writer for idle comments.
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              await Promise.race([
                stream.write(": keep-alive\n\n"),
                new Promise<never>((_, reject) => {
                  timer = setTimeout(() => reject(new Error("Slow stream")), 2000);
                }),
              ]);
            } finally {
              clearTimeout(timer);
            }
          }
        }
      } catch {
        // Closing this writer never changes the gateway run's state.
        await stream.close().catch(() => {});
      } finally {
        clearTimeout(deadline);
        clearInterval(heartbeat);
        close();
      }
    });
  });
  app.post("/api/conversations/:id/runs/:runId/cancel", async (c) => {
    const body = c.get("body");
    if (Object.keys(body).length)
      throw new ApiError(400, "INVALID_INPUT", "Use an empty JSON object.");
    return c.json(await chat.cancel(c.req.param("id"), c.req.param("runId")), 202);
  });
}
