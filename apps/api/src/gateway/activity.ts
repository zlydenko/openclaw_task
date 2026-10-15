import { record, text } from "../validation.ts";
import type { ToolActivity, ToolEvent } from "../types.ts";

export const toolIdentifier = (value: unknown) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 256 &&
  !/\s/.test(value) &&
  [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    ? value
    : "";

export function toolTarget(name: string, value: unknown) {
  if (!["read", "write", "edit", "apply_patch"].includes(name)) return;

  const args = record(value);
  const path =
    text(args.path) ||
    text(args.file_path) ||
    text(args.input).match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/m)?.[1] ||
    text(args.input).match(/^--- a\/(.+)$/m)?.[1];
  const base = path?.replaceAll("\\", "/").split("/").at(-1);

  if (
    base &&
    /^[\w .-]{1,80}$/.test(base) &&
    !/secret|token|credential|api.?key|^\.env|pem$/i.test(base)
  )
    return base;
}

export function toolOutcome(value: unknown, isError?: unknown): ToolActivity["status"] {
  const result = record(value);
  const details = record(result.details);
  if (
    [
      "running",
      "pending",
      "approval-pending",
      "approval-unavailable",
      "unknown",
      "timeout",
      "cancelled",
      "partial",
    ].includes(text(details.status))
  )
    return "unknown";
  if (
    isError === true ||
    result.isError === true ||
    ["error", "failed", "blocked", "denied"].includes(text(details.status))
  )
    return "failed";
  return isError === false || result.isError === false ? "completed" : "unknown";
}

export function toolDetail(result: unknown, failed: boolean) {
  if (!failed) return "The tool returned a result. Raw output is omitted.";
  const row = record(result);
  const content = Array.isArray(row.content) ? row.content : [];
  const error = content
    .slice(0, 20)
    .map((block) => text(record(block).text).slice(0, 2000))
    .join(" ");

  if (/invalid patch hunk|invalid patch.*header/i.test(error))
    return "Invalid patch format. Use an Update File, Add File, or Delete File header.";
  if (/denied|forbidden|not allowed|permission|approval|unauthori[sz]ed/i.test(error))
    return "Permission or approval was not granted.";
  if (/timed?\s*out|timeout|unknown outcome|connection.*(lost|closed|reset)/i.test(error))
    return "The tool outcome could not be confirmed.";
  if (/Tool \S+ not found/i.test(error))
    return "The agent requested a tool that is not available. No matching tool executed.";
  if (/ENOENT|no such file|not found/i.test(error)) return "The requested resource was not found.";
  if (/missing required|invalid (argument|parameter)|validation.*(failed|error)/i.test(error))
    return "The tool rejected its parameters.";
  if (/temporar|EAGAIN|EBUSY|rate.limit|429|503|service unavailable/i.test(error))
    return "The tool reported a temporary failure.";

  return failed
    ? "The tool reported an error. Raw output is omitted."
    : "The tool returned a result. Raw output is omitted.";
}

export function readToolEvent(value: unknown, stream: string): ToolEvent | null {
  const event = record(value);
  const data = record(event.data);
  const id = toolIdentifier(data.toolCallId);
  const name = toolIdentifier(data.name);

  if (!toolIdentifier(event.runId) || !Number.isInteger(event.seq) || !id || !name) return null;
  if (stream !== "tool") return null;

  const phase = data.phase;
  if (!["start", "update", "result", "end"].includes(text(phase))) return null;

  const outcome = toolOutcome(data.result, data.isError);
  const failed = outcome === "failed";
  const detail =
    phase === "result" || phase === "end" ? toolDetail(data.result, failed) : undefined;
  const status = phase === "result" || phase === "end" ? outcome : "running";

  return {
    ...(typeof event.sessionKey === "string" ? { sessionKey: event.sessionKey } : {}),
    runId: text(event.runId),
    seq: Number(event.seq),
    activity: {
      id,
      name,
      status: detail === "The tool outcome could not be confirmed." ? "unknown" : status,
      ...(toolTarget(name, data.args) ? { target: toolTarget(name, data.args) } : {}),
      ...(detail ? { detail } : {}),
    },
  };
}
