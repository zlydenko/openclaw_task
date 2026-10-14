import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";

import { ApiError } from "./errors.ts";
import { pageFrom } from "./pagination.ts";
import { uuid } from "./validation.ts";
import type { ApiContext, ApiEnv, JsonRecord } from "./types.ts";

export function requestBoundary(origin: string, developmentOrigin?: string) {
  const origins = new Set([
    new URL(origin).origin,
    ...(developmentOrigin ? [new URL(developmentOrigin).origin] : []),
  ]);
  const hosts = new Set([...origins].map((value) => new URL(value).host));

  const boundary = createMiddleware<ApiEnv>(async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "no-store");

    if (!hosts.has(c.req.header("host") ?? "")) {
      throw new ApiError(400, "INVALID_HOST", "Host is not allowed.");
    }

    const requestOrigin = c.req.header("origin");

    if (requestOrigin && !origins.has(requestOrigin)) {
      throw new ApiError(400, "INVALID_ORIGIN", "Origin is not allowed.");
    }

    if (c.req.header("sec-fetch-site") === "cross-site") {
      throw new ApiError(400, "CROSS_SITE_REQUEST", "Cross-site requests are not allowed.");
    }

    await next();
  });

  return [
    boundary,
    cors({
      origin: [...origins],
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
    bodyLimit({
      maxSize: 16 * 1024,
      onError: () => {
        throw new ApiError(413, "BODY_LIMIT", "Request body must not exceed 16 KiB.");
      },
    }),
  ];
}

export const jsonBody = createMiddleware<ApiEnv>(async (c, next) => {
  if (c.req.method !== "POST") return next();

  if (c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new ApiError(400, "JSON_REQUIRED", "Use application/json.");
  }

  let body: unknown;

  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "The JSON body is invalid.");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "INVALID_INPUT", "Use a JSON object.");
  }

  c.set("body", body as JsonRecord);

  await next();
});

export const emptyBody = createMiddleware<ApiEnv>(async (c, next) => {
  if (Object.keys(c.var.body).length) {
    throw new ApiError(400, "INVALID_INPUT", "Use an empty JSON object.");
  }

  await next();
});

export const messageBody = createMiddleware<ApiEnv>(async (c, next) => {
  const body = c.var.body;

  if (
    Object.keys(body).some((key) => key !== "requestId" && key !== "text") ||
    typeof body.requestId !== "string" ||
    !uuid.test(body.requestId) ||
    typeof body.text !== "string" ||
    !body.text.trim()
  ) {
    throw new ApiError(400, "INVALID_INPUT", "Use a UUID requestId and non-empty text.");
  }

  if (Buffer.byteLength(body.text) > 8192) {
    throw new ApiError(413, "TEXT_LIMIT", "Message text must not exceed 8 KiB.");
  }

  c.set("messageInput", { requestId: body.requestId.toLowerCase(), text: body.text });

  await next();
});

export const conversationParams = createMiddleware<ApiEnv>(async (c, next) => {
  const id = c.req.param("id");

  if (!id || !uuid.test(id)) {
    throw new ApiError(404, "NOT_FOUND", "Conversation not found.");
  }

  c.set("conversationId", id);

  const runId = c.req.param("runId");

  if (runId !== undefined) c.set("runId", runId);

  await next();
});

export const pagination = (scope: (c: ApiContext) => string = () => "list") =>
  createMiddleware<ApiEnv>(async (c, next) => {
    c.set("page", pageFrom(c.req.query("limit"), c.req.query("cursor"), scope(c)));

    await next();
  });
