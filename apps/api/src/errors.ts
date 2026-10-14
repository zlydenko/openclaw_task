import { randomUUID } from "node:crypto";
import type { ErrorHandler, NotFoundHandler } from "hono";

import type { ApiEnv, ApiStatus, JsonRecord } from "./types.ts";

export class ApiError extends Error {
  constructor(
    public status: ApiStatus,
    public code: string,
    message: string,
    public details: JsonRecord = {},
  ) {
    super(message);
  }
}

export const handleError: ErrorHandler<ApiEnv> = (error, c) => {
  const failure =
    error instanceof ApiError
      ? error
      : new ApiError(503, "GATEWAY_UNAVAILABLE", "The request could not be completed.");
  const requestId = randomUUID();

  console.error(JSON.stringify({ event: "http_error", requestId, code: failure.code }));

  return c.json(
    { error: { code: failure.code, message: failure.message, requestId, ...failure.details } },
    failure.status,
  );
};

export const handleNotFound: NotFoundHandler<ApiEnv> = (c) =>
  c.json(
    { error: { code: "NOT_FOUND", message: "Route not found.", requestId: randomUUID() } },
    404,
  );
