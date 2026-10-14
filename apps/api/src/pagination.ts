import { ApiError } from "./errors.ts";
import { record } from "./validation.ts";
import type { Page } from "./types.ts";

export function pageFrom(limit?: string, cursor?: string, scope = "list"): Page {
  const size = limit === undefined ? 50 : Number(limit);

  if (!Number.isInteger(size) || size < 1 || size > 100) {
    throw new ApiError(400, "INVALID_PAGE", "Use a limit from 1 to 100.");
  }

  if (!cursor) return { limit: size, offset: 0, emptyOffset: 0 };

  try {
    if (cursor.length > 512) throw new Error();

    const data = record(JSON.parse(Buffer.from(cursor, "base64url").toString()));

    if (
      data.scope !== scope ||
      !Number.isSafeInteger(data.offset) ||
      Number(data.offset) < 0 ||
      !Number.isSafeInteger(data.emptyOffset) ||
      Number(data.emptyOffset) < 0
    ) {
      throw new Error();
    }

    return { limit: size, offset: Number(data.offset), emptyOffset: Number(data.emptyOffset) };
  } catch {
    throw new ApiError(400, "INVALID_CURSOR", "The page cursor is invalid.");
  }
}

export const cursorFor = (scope: string, offset: number, emptyOffset = 0) =>
  Buffer.from(JSON.stringify({ scope, offset, emptyOffset })).toString("base64url");
