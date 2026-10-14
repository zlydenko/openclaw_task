import { Hono } from "hono";

import type { Chat } from "./chat.ts";
import { handleError, handleNotFound } from "./errors.ts";
import { jsonBody, requestBoundary } from "./middleware.ts";
import { registerRoutes } from "./routes.ts";
import type { ApiEnv } from "./types.ts";

export function createApp(
  chat: Chat,
  origin = "http://localhost:3000",
  developmentOrigin?: string,
) {
  const app = new Hono<ApiEnv>();

  app.use("*", ...requestBoundary(origin, developmentOrigin));
  app.use("/api/*", jsonBody);

  app.onError(handleError);
  app.notFound(handleNotFound);

  registerRoutes(app, chat);

  return app;
}
