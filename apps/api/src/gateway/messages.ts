import { createHash } from "node:crypto";

import { toolDetail, toolTarget, toolIdentifier, toolOutcome } from "./activity.ts";
import type { ChatEvent, ToolActivity, ProjectedMessage, MessageImage } from "../types.ts";
import { record, text } from "../validation.ts";

export const namespace = "agent:main:dashboard:assessment-api-";
export const legacyNamespace = "agent:main:assessment-api-";

export const sessionKey = (id: string) => namespace + id;

export const conversationId = (key: unknown) => {
  const value = text(key);

  const prefix = [namespace, legacyNamespace].find((item) => value.startsWith(item));

  return prefix ? value.slice(prefix.length) : null;
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

            if (block.type === "attachment" && record(block.attachment).kind === "image") return [];

            if (
              ![
                "image",
                "input_image",
                "image_url",
                "thinking",
                "reasoning",
                "toolCall",
                "tool_use",
                "toolResult",
                "tool_result",
              ].includes(text(block.type))
            )
              unsupported = true;

            return [];
          })
          .join("");

  return { text: content, unsupported };
}

function messageImages(row: unknown): MessageImage[] {
  const message = record(row);
  const content = Array.isArray(message.content) ? message.content : [];
  const facts = record(message.__openclaw).media;
  // Native media facts keep original filenames even when inline blocks omit them.
  const saved = (Array.isArray(facts) ? facts : []).flatMap((item) => {
    const fact = record(item);
    return fact.kind === "image" || text(fact.contentType).startsWith("image/")
      ? [{ fileName: text(fact.fileName).slice(0, 200) || "Attached image" }]
      : [];
  });
  if (saved.length) return saved.slice(0, 4);

  const images = content.flatMap((item) => {
    const block = record(item);
    if (["image", "input_image", "image_url"].includes(text(block.type)))
      return [{ fileName: text(block.fileName).slice(0, 200) || "Attached image" }];
    const attachment = record(block.attachment);
    return block.type === "attachment" && attachment.kind === "image"
      ? [{ fileName: text(attachment.label).slice(0, 200) || "Attached image" }]
      : [];
  });
  return images.slice(0, 4);
}

export function projectMessages(messages: unknown[]) {
  let budget = 320 * 1024;
  const occurrences = new Map<string, number>();

  const projected = new Map<string, ProjectedMessage>();
  const results = new Map<string, unknown>();
  let toolCount = 0;

  for (const value of messages) {
    const row = record(value);
    if (row.role === "toolResult" && typeof row.toolCallId === "string")
      results.set(row.toolCallId, row);
  }

  const addTool = (value: unknown, outcome?: unknown) => {
    const call = record(value);
    const id = text(call.id) || text(call.toolCallId);
    const name = text(call.name) || text(call.toolName) || "tool";
    if (!toolIdentifier(id) || !/^[\w.:-]{1,120}$/.test(name)) return;
    const key = "tool:" + id;
    if (!projected.has(key) && toolCount++ >= 128) return;

    const result = record(outcome);
    const detail = outcome ? toolDetail(result, result.isError === true) : undefined;
    const status =
      detail === "The tool outcome could not be confirmed." ? "unknown" : toolOutcome(result);
    const activity: ToolActivity = {
      id,
      name,
      status,
    };
    const target = toolTarget(name, call.arguments ?? call.input);
    if (target) activity.target = target;
    if (detail) activity.detail = detail;
    projected.set(key, { id: key, role: "assistant", text: "", activities: [activity] });
  };

  for (const value of messages) {
    const row = record(value);

    if (row.role === "toolResult") {
      if (!projected.has("tool:" + text(row.toolCallId))) addTool(row, row);
      continue;
    }
    if (row.role !== "user" && row.role !== "assistant") continue;

    const visible = visibleMessage(row);
    const images = messageImages(row);
    const meta = record(row.__openclaw);
    const base =
      text(meta.id) ||
      text(row.id) ||
      createHash("sha256")
        .update(
          JSON.stringify([
            row.role,
            row.timestamp,
            visible.text,
            record(row.__openclaw).media,
            images,
          ]),
        )
        .digest("hex");
    const sibling = occurrences.get(base) ?? 0;
    occurrences.set(base, sibling + 1);

    const imageBytes = Buffer.byteLength(JSON.stringify(images));
    const displayImages = imageBytes <= budget ? images : [];
    budget = Math.max(0, budget - imageBytes);

    const bytes = Buffer.from(visible.text);
    const cap = Math.min(64 * 1024, Math.floor(budget / 6));
    const clipped = bytes
      .subarray(0, cap)
      .toString("utf8")
      .replace(/\uFFFD$/, "");

    budget = Math.max(0, budget - Buffer.byteLength(JSON.stringify(clipped)));

    if (clipped || images.length || visible.unsupported || row.role === "user") {
      const id = `${base}:${row.role}:${sibling}`;
      projected.set(id, {
        id,
        role: row.role,
        text: clipped,
        unsupported: visible.unsupported,
        ...(displayImages.length ? { images: displayImages } : {}),
        truncated: bytes.length > cap || images.length > displayImages.length,
      });
    }

    if (Array.isArray(row.content))
      for (const block of row.content) {
        const call = record(block);
        if (call.type === "toolCall" || call.type === "tool_use")
          addTool(call, results.get(text(call.id)));
      }
  }

  if (toolCount > 128)
    projected.set("activity-limit", {
      id: "activity-limit",
      role: "assistant",
      text: "Additional tool activity is omitted by the display limit.",
      truncated: true,
    });
  return [...projected.values()];
}
