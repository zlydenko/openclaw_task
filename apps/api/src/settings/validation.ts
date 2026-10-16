import { ApiError } from "../errors.ts";
import type { FileInput, JsonRecord, SettingsInput, WorkspaceFileName } from "../types.ts";

const invalid = (message: string): never => {
  throw new ApiError(400, "INVALID_SETTINGS", message);
};

export function settingsInput(body: JsonRecord): SettingsInput {
  if (
    Object.keys(body).some(
      (key) => !["baseHash", "chatModel", "imageModel", "toolChanges"].includes(key),
    ) ||
    typeof body.baseHash !== "string" ||
    !body.baseHash ||
    body.baseHash.length > 256
  )
    return invalid("Use a settings baseHash and supported fields.");
  for (const key of ["chatModel", "imageModel"])
    if (
      body[key] !== undefined &&
      (typeof body[key] !== "string" || String(body[key]).length > 160)
    )
      return invalid("Use a reviewed model ID.");
  if (body.toolChanges !== undefined) {
    if (
      !body.toolChanges ||
      typeof body.toolChanges !== "object" ||
      Array.isArray(body.toolChanges)
    )
      return invalid("Use exact tool IDs mapped to booleans.");
    const entries = Object.entries(body.toolChanges);
    if (
      entries.length > 128 ||
      entries.some(
        ([id, value]) => !/^[a-zA-Z0-9_.:-]{1,160}$/.test(id) || typeof value !== "boolean",
      )
    )
      return invalid("Use at most 128 exact tool changes.");
  }
  return body as SettingsInput;
}

export function fileName(value?: string): WorkspaceFileName {
  if (value !== "USER.md" && value !== "MEMORY.md")
    throw new ApiError(404, "FILE_NOT_FOUND", "Workspace file not found.");
  return value;
}

export function fileInput(body: JsonRecord): FileInput {
  if (
    Object.keys(body).some(
      (key) => !["content", "expectedHash", "expectedMissing"].includes(key),
    ) ||
    typeof body.content !== "string" ||
    (body.expectedHash !== undefined &&
      (typeof body.expectedHash !== "string" || !/^[a-fA-F0-9]{64}$/.test(body.expectedHash))) ||
    (body.expectedMissing !== undefined && body.expectedMissing !== true) ||
    (body.expectedHash !== undefined) === (body.expectedMissing === true)
  )
    return invalid("Use content with exactly one native file revision guard.");
  if (Buffer.byteLength(body.content) > 65536)
    throw new ApiError(413, "FILE_LIMIT", "File content must not exceed 64 KiB of UTF-8.");
  return body as FileInput;
}
