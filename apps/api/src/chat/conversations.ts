import { randomUUID } from "node:crypto";

import { ApiError } from "../errors.ts";
import { storedImages } from "../gateway/images.ts";
import { conversationId, projectMessages, visibleMessage } from "../gateway/messages.ts";
import { isFallbackName, titleFromUserText } from "../gateway/titles.ts";
import type { OpenClaw } from "../openclaw.ts";
import { cursorFor } from "../pagination.ts";
import { record, text, uuid } from "../validation.ts";
import type { ConversationItem, Page, Run } from "../types.ts";

export class Conversations {
  private empty = new Map<string, number>();
  private fallbackTitles = new Map<string, Promise<string>>();

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
        const label = text(row.label);
        const saved = label || text(row.displayName) || text(row.derivedTitle);
        const title =
          label || (saved && !isFallbackName(saved))
            ? saved
            : (await this.fallbackTitle(id)) || saved;

        items.push({
          id,
          ...(title ? { title: title.slice(0, 200) } : {}),
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

  private fallbackTitle(id: string) {
    const cached = this.fallbackTitles.get(id);
    if (cached) return cached;

    const pending = this.readFallbackTitle(id).catch(() => "");
    this.fallbackTitles.set(id, pending);
    if (this.fallbackTitles.size > 512)
      this.fallbackTitles.delete(this.fallbackTitles.keys().next().value!);

    void pending.then((title) => {
      if (!title && this.fallbackTitles.get(id) === pending) this.fallbackTitles.delete(id);
    });

    return pending;
  }

  private async readFallbackTitle(id: string) {
    let history = await this.gateway.history(id, 20, 0);

    if (typeof history.totalMessages === "number" && history.totalMessages > 20)
      history = await this.gateway.history(id, 20, history.totalMessages - 20);

    const user = history.messages?.map(record).find((message) => message.role === "user");

    return user ? titleFromUserText(visibleMessage(user).text) : "";
  }

  async known(id: string, active: Run | null = null) {
    if (this.empty.has(id) || active?.conversationId === id) return;

    const result = await this.gateway.roster(10, 0, false, "assessment-api-" + id);

    if (result.sessions.some((row) => conversationId(row.key) === id)) return;
    throw new ApiError(404, "NOT_FOUND", "Conversation not found.");
  }

  async image(id: string, messageId: string, index: number) {
    const result = await this.gateway.message(id, messageId);
    const source = result.ok ? storedImages(result.message)[index]?.source : undefined;
    if (!source) throw new ApiError(404, "IMAGE_NOT_FOUND", "Image not found.");

    return this.gateway.image(id, source);
  }

  async history(id: string, page: Page, hasActiveRun: boolean) {
    const history =
      this.empty.has(id) && !hasActiveRun
        ? {}
        : await this.gateway.history(id, page.limit, page.offset);

    return {
      id,
      messages: projectMessages(history.messages ?? [], id),
      nextCursor:
        history.hasMore && history.nextOffset !== undefined
          ? cursorFor(id, history.nextOffset)
          : null,
    };
  }
}
