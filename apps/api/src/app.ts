import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { ApiError, type Chat } from "./chat.ts";
import { registerRoutes, type ApiEnv } from "./routes.ts";

export function createApp(
  chat: Chat,
  origin = "http://localhost:3000",
  developmentOrigin?: string,
) {
  const origins = new Set([
    new URL(origin).origin,
    ...(developmentOrigin ? [new URL(developmentOrigin).origin] : []),
  ]);
  const hosts = new Set([...origins].map((value) => new URL(value).host));
  const app = new Hono<ApiEnv>();
  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "no-store");
    if (!hosts.has(c.req.header("host") ?? ""))
      throw new ApiError(400, "INVALID_HOST", "Host is not allowed.");
    const requestOrigin = c.req.header("origin");
    if (requestOrigin && !origins.has(requestOrigin))
      throw new ApiError(400, "INVALID_ORIGIN", "Origin is not allowed.");
    if (c.req.header("sec-fetch-site") === "cross-site")
      throw new ApiError(400, "CROSS_SITE_REQUEST", "Cross-site requests are not allowed.");
    await next();
  });
  app.use(
    "*",
    cors({
      origin: [...origins],
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );
  app.use(
    "*",
    bodyLimit({
      maxSize: 16 * 1024,
      onError: () => {
        throw new ApiError(413, "BODY_LIMIT", "Request body must not exceed 16 KiB.");
      },
    }),
  );
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "POST") {
      if (c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json")
        throw new ApiError(400, "JSON_REQUIRED", "Use application/json.");
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        throw new ApiError(400, "INVALID_JSON", "The JSON body is invalid.");
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new ApiError(400, "INVALID_INPUT", "Use a JSON object.");
      c.set("body", body as Record<string, unknown>);
    }
    await next();
  });
  app.onError((error, c) => {
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
  });
  app.notFound((c) =>
    c.json(
      { error: { code: "NOT_FOUND", message: "Route not found.", requestId: randomUUID() } },
      404,
    ),
  );
  registerRoutes(app, chat);
  return app;
}
