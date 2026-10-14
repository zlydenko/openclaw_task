import { createHash } from "node:crypto";

import { record, text } from "../validation.ts";
import type { ChatEvent } from "../types.ts";

export const namespace = "agent:main:assessment-api-";

export const sessionKey = (id: string) => namespace + id;

export const conversationId = (key: unknown) => {
  const value = text(key);

  return value.startsWith(namespace) ? value.slice(namespace.length) : null;
};

export function readChatEvent(value: unknown): ChatEvent | null {
  const payload = record(value);

  if (
    typeof payload.sessionKey !== "string" ||
    typeof payload.runId !== "string" ||
    !Number.isInteger(payload.seq)
  ) {
    return null;
  }

  return payload as ChatEvent;
}

export function visibleMessage(value: unknown) {
  const message = record(value);
  let unsupported = false;
  const content =
    typeof message.content === "string"
      ? message.content
      : (Array.isArray(message.content) ? message.content : [])
          .flatMap((item) => {
            const block = record(item);

            if (block.type === "text") return [text(block.text)];

            if (block.type !== "thinking" && block.type !== "reasoning") unsupported = true;

            return [];
          })
          .join("");

  return { text: content, unsupported };
}

export function projectMessages(messages: unknown[]) {
  let budget = 400 * 1024;
  const occurrences = new Map<string, number>();

  // Keep every gateway row in the page, but cap each visible projection.
  return messages.flatMap((value) => {
    const row = record(value);

    if (row.role !== "user" && row.role !== "assistant") return [];

    const visible = visibleMessage(row);
    const meta = record(row.__openclaw);
    const base =
      text(meta.id) ||
      text(row.id) ||
      createHash("sha256")
        .update(JSON.stringify([row.role, row.timestamp, visible.text]))
        .digest("hex");
    const sibling = occurrences.get(base) ?? 0;
    occurrences.set(base, sibling + 1);

    const bytes = Buffer.from(visible.text);
    const cap = Math.min(64 * 1024, Math.floor(budget / 6));
    const clipped = bytes
      .subarray(0, cap)
      .toString("utf8")
      .replace(/\uFFFD$/, "");

    budget = Math.max(0, budget - Buffer.byteLength(JSON.stringify(clipped)));

    return [
      {
        id: `${base}:${row.role}:${sibling}`,
        role: row.role,
        text: clipped,
        unsupported: visible.unsupported,
        truncated: bytes.length > cap,
      },
    ];
  });
}
