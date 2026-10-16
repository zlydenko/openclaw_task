import type { Chat } from "./chat.ts";
import { createChatController, createSettingsController } from "./controller.ts";
import {
  conversationParams,
  emptyBody,
  imageParams,
  messageBody,
  pagination,
  settingsBody,
  workspaceFileParams,
  workspaceFileBody,
} from "./middleware.ts";
import type { ApiApp } from "./types.ts";

export function registerRoutes(app: ApiApp, chat: Chat) {
  const controller = createChatController(chat);
  const settings = createSettingsController(chat);

  app.get("/api/settings", settings.read);
  app.patch("/api/settings", settingsBody, settings.apply);
  app.get("/api/settings/files/:name", workspaceFileParams, settings.file);
  app.put("/api/settings/files/:name", workspaceFileParams, workspaceFileBody, settings.saveFile);

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

  app.get(
    "/api/conversations/:id/images/:messageId/:index",
    conversationParams,
    imageParams,
    controller.image,
  );

  app.post("/api/conversations/:id/messages", messageBody, conversationParams, controller.send);
  app.post(
    "/api/conversations/:id/runs/:runId/cancel",
    emptyBody,
    conversationParams,
    controller.cancel,
  );
}
