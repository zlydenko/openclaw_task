import type { Chat } from "./chat.ts";
import { createChatController } from "./controller.ts";
import { conversationParams, emptyBody, messageBody, pagination } from "./middleware.ts";
import type { ApiApp } from "./types.ts";

export function registerRoutes(app: ApiApp, chat: Chat) {
  const controller = createChatController(chat);

  app.get("/health", controller.health);
  app.get("/ready", controller.ready);

  app.post("/api/conversations", emptyBody, controller.create);
  app.get("/api/conversations", pagination(), controller.list);

  app.get(
    "/api/conversations/:id",
    pagination((c) => c.req.param("id") ?? ""),
    conversationParams,
    controller.history,
  );

  app.post("/api/conversations/:id/messages", messageBody, conversationParams, controller.send);
  app.post(
    "/api/conversations/:id/runs/:runId/cancel",
    emptyBody,
    conversationParams,
    controller.cancel,
  );
}
