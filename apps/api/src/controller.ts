import type { Chat } from "./chat.ts";
import { streamReply } from "./stream.ts";
import type { ChatController } from "./types.ts";

export function createChatController(chat: Chat): ChatController {
  return {
    health: (c) => c.json({ status: "ok" }),

    ready: (c) =>
      c.json(
        chat.ready ? { status: "ready" } : { status: "unavailable", reason: chat.reason },
        chat.ready ? 200 : 503,
      ),

    create: (c) => c.json(chat.create(), 201),

    list: async (c) => c.json(await chat.list(c.var.page)),

    history: async (c) => c.json(await chat.history(c.var.conversationId, c.var.page)),

    send: async (c) => {
      const { requestId, text } = c.var.messageInput;
      const run = await chat.send(c.var.conversationId, requestId, text);

      return streamReply(c, run);
    },

    cancel: async (c) => c.json(await chat.cancel(c.var.conversationId, c.var.runId), 202),
  };
}
