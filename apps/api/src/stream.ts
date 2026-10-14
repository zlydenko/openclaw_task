import { streamSSE } from "hono/streaming";

import type { ApiContext, StreamEvent, Submission } from "./types.ts";

async function boundedWrite(operation: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Slow stream")), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function streamReply(c: ApiContext, run: Submission) {
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

    const heartbeat = setInterval(() => wake?.(), 15_000);
    const write = (event: StreamEvent) =>
      boundedWrite(stream.writeSSE({ event: event.event, data: JSON.stringify(event.data) }));

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
          await boundedWrite(stream.write(": keep-alive\n\n"));
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
}
