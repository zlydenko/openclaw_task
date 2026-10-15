import type { StreamEvent } from "./types.ts";

const names = new Set(["accepted", "message", "completed", "cancelled", "failed"]);

export async function readEvents(
  body: ReadableStream<Uint8Array>,
  receive: (event: StreamEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";
  let data: string[] = [];
  let frameSize = 0;
  let finished = false;

  const line = (value: string) => {
    if (!value) {
      if (data.length && names.has(event)) {
        const parsed: unknown = JSON.parse(data.join("\n"));

        if (!parsed || typeof parsed !== "object") throw new Error("Invalid stream event.");
        const payload = parsed as StreamEvent["data"];

        if (
          typeof payload.conversationId !== "string" ||
          !(payload.requestId === null || typeof payload.requestId === "string") ||
          !(payload.runId === null || typeof payload.runId === "string") ||
          (payload.text !== undefined && typeof payload.text !== "string")
        )
          throw new Error("Invalid stream event.");

        receive({ event: event as StreamEvent["event"], data: payload });
        finished = event === "completed" || event === "cancelled" || event === "failed";
      }

      event = "";
      data = [];
      frameSize = 0;
      return;
    }

    if (value.startsWith(":")) return;
    frameSize += value.length;
    if (frameSize > 512 * 1024) throw new Error("Stream event exceeds the display limit.");

    const colon = value.indexOf(":");
    const field = colon < 0 ? value : value.slice(0, colon);
    const content = colon < 0 ? "" : value.slice(colon + 1).replace(/^ /, "");

    if (field === "event") event = content;
    if (field === "data") data.push(content);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

      let boundary: number;

      while ((boundary = buffer.search(/[\r\n]/)) >= 0) {
        if (!done && buffer[boundary] === "\r" && boundary === buffer.length - 1) break;

        const width = buffer[boundary] === "\r" && buffer[boundary + 1] === "\n" ? 2 : 1;
        line(buffer.slice(0, boundary));
        if (finished) return;
        buffer = buffer.slice(boundary + width);
      }

      if (buffer.length > 512 * 1024) throw new Error("Stream event exceeds the display limit.");
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
