import { randomUUID } from "node:crypto";

import { ApiError } from "../errors.ts";
import { conversationId, projectMessages, sessionKey } from "../gateway/messages.ts";
import type { OpenClaw } from "../openclaw.ts";
import { cursorFor } from "../pagination.ts";
import { text, uuid } from "../validation.ts";
import type { ConversationItem, Page, Run } from "../types.ts";

export class Conversations {
  private empty = new Map<string, number>();

  constructor(private gateway: OpenClaw) {}

  accepted(id: string) {
    this.empty.delete(id);
  }

  create() {
    if (this.empty.size >= 1000)
      throw new ApiError(
        409,
        "CONVERSATION_LIMIT",
        "Send a message before creating more empty conversations.",
      );

    const id = randomUUID();
    this.empty.set(id, Date.now());

    return { id };
  }

  async list(page: Page) {
    const empties = [...this.empty].sort((a, b) => b[1] - a[1]);
    const items: ConversationItem[] = empties
      .slice(page.emptyOffset, page.emptyOffset + page.limit)
      .map(([id, updatedAt]) => ({ id, updatedAt }));
    const emptyOffset = page.emptyOffset + items.length;

    if (items.length === page.limit)
      return { items, nextCursor: cursorFor("list", page.offset, emptyOffset) };
    let offset = page.offset;

    for (let count = 0; count < 20; count++) {
      const result = await this.gateway.roster(page.limit - items.length, offset);

      for (const row of result.sessions ?? []) {
        const id = conversationId(row.key);

        if (!id || !uuid.test(id) || this.empty.has(id)) continue;
        items.push({
          id,
          ...(text(row.derivedTitle) || text(row.label)
            ? { title: (text(row.derivedTitle) || text(row.label)).slice(0, 200) }
            : {}),
          ...(typeof row.updatedAt === "number" ? { updatedAt: row.updatedAt } : {}),
        });
      }

      const more =
        result.hasMore === true ||
        (result.total !== undefined && offset + (result.sessions?.length ?? 0) < result.total);
      const next = result.nextOffset ?? offset + (result.sessions?.length ?? 0);

      if (!more || next <= offset) return { items, nextCursor: null };
      offset = next;

      if (items.length >= page.limit)
        return { items, nextCursor: cursorFor("list", offset, emptyOffset) };
    }
    return { items, nextCursor: cursorFor("list", offset, emptyOffset) };
  }

  async known(id: string, active: Run | null = null) {
    if (this.empty.has(id) || active?.conversationId === id) return;

    const result = await this.gateway.roster(10, 0, false, "assessment-api-" + id);

    if (result.sessions.some((row) => row.key === sessionKey(id))) return;
    throw new ApiError(404, "NOT_FOUND", "Conversation not found.");
  }

  async history(id: string, page: Page, hasActiveRun: boolean) {
    const history =
      this.empty.has(id) && !hasActiveRun
        ? {}
        : await this.gateway.history(id, page.limit, page.offset);

    return {
      id,
      messages: projectMessages(history.messages ?? []),
      nextCursor:
        history.hasMore && history.nextOffset !== undefined
          ? cursorFor(id, history.nextOffset)
          : null,
    };
  }
}
