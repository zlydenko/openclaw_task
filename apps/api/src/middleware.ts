import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";

import { ApiError } from "./errors.ts";
import { pageFrom } from "./pagination.ts";
import { imageAttachments, MESSAGE_BODY_LIMIT } from "./images.ts";
import { uuid } from "./validation.ts";
import { settingsInput, fileInput, fileName } from "./settings/validation.ts";
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
      allowMethods: ["GET", "POST", "PATCH", "PUT", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
    createMiddleware<ApiEnv>(async (c, next) =>
      bodyLimit({
        maxSize:
          c.req.method === "POST" && /^\/api\/conversations\/[^/]+\/messages$/.test(c.req.path)
            ? MESSAGE_BODY_LIMIT
            : c.req.method === "PUT" && /^\/api\/settings\/files\/[^/]+$/.test(c.req.path)
              ? 128 * 1024
              : 16 * 1024,
        onError: () => {
          throw new ApiError(413, "BODY_LIMIT", "Request body exceeds the allowed size.");
        },
      })(c, next),
    ),
  ];
}

export const jsonBody = createMiddleware<ApiEnv>(async (c, next) => {
  if (!["POST", "PATCH", "PUT"].includes(c.req.method)) return next();

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
    Object.keys(body).some(
      (key) => key !== "requestId" && key !== "text" && key !== "attachments",
    ) ||
    typeof body.requestId !== "string" ||
    !uuid.test(body.requestId) ||
    typeof body.text !== "string"
  ) {
    throw new ApiError(400, "INVALID_INPUT", "Use a UUID requestId and message text.");
  }

  if (Buffer.byteLength(body.text) > 8192) {
    throw new ApiError(413, "TEXT_LIMIT", "Message text must not exceed 8 KiB.");
  }

  const attachments = imageAttachments(body.attachments);

  if (!body.text.trim() && !attachments?.length) {
    throw new ApiError(400, "INVALID_INPUT", "Add message text or an image.");
  }

  c.set("messageInput", { requestId: body.requestId.toLowerCase(), text: body.text, attachments });

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

export const imageParams = createMiddleware<ApiEnv>(async (c, next) => {
  const messageId = c.req.param("messageId");
  const index = c.req.param("index");
  if (
    !messageId ||
    messageId.length > 256 ||
    !/^[\w.:-]+$/.test(messageId) ||
    !/^[0-3]$/.test(index ?? "")
  )
    throw new ApiError(404, "IMAGE_NOT_FOUND", "Image not found.");

  c.set("imageMessageId", messageId);
  c.set("imageIndex", Number(index));
  await next();
});

export const pagination = (scope: (c: ApiContext) => string = () => "list") =>
  createMiddleware<ApiEnv>(async (c, next) => {
    c.set("page", pageFrom(c.req.query("limit"), c.req.query("cursor"), scope(c)));

    await next();
  });

export const settingsBody = createMiddleware<ApiEnv>(async (c, next) => {
  c.set("settingsInput", settingsInput(c.var.body));
  await next();
});

export const workspaceFileParams = createMiddleware<ApiEnv>(async (c, next) => {
  c.set("workspaceFileName", fileName(c.req.param("name")));
  await next();
});

export const workspaceFileBody = createMiddleware<ApiEnv>(async (c, next) => {
  c.set("workspaceFileInput", fileInput(c.var.body));
  await next();
});
