import { mergeHistory } from "./activity.ts";
import { api, ApiError } from "./api.ts";
import { RunController } from "./run.ts";
import { initialState, isBusy, mergeById } from "./state.ts";
import type { ChatState } from "./types.ts";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Connection unavailable. Try checking again.";

export class ChatController {
  private state = initialState();
  private listeners = new Set<() => void>();
  private historyRequests = new Set<string>();
  private listRevision = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private started = false;
  private refreshing = false;
  private runner = new RunController({
    change: (turn) =>
      this.update({
        turns: { ...this.state.turns, [turn.conversationId]: turn },
        active: isBusy(turn.phase) ? turn : null,
      }),
    accepted: (id, input) => {
      if (this.state.drafts[id] === input) this.draft(id, "");
    },
    settled: (id) => {
      void this.loadHistory(id);
      void this.loadList();
    },
  });

  snapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<ChatState>) {
    this.state = { ...this.state, ...patch };

    for (const listener of this.listeners) listener();
  }

  select = (id: string | null) => {
    this.update({ selected: id });
    if (id) void this.loadHistory(id);
  };

  draft = (id: string, text: string) => {
    this.update({ drafts: { ...this.state.drafts, [id]: text } });
  };

  create = async () => {
    if (this.state.creating || !this.state.ready) return null;

    this.update({ creating: true, listError: "" });

    try {
      const { id } = await api.create();
      this.listRevision++;
      this.update({ items: [{ id }, ...this.state.items] });

      return id;
    } catch (error) {
      this.update({ listError: errorText(error) });
      return null;
    } finally {
      this.update({ creating: false });
    }
  };

  loadList = async (more = false) => {
    if (this.state.listLoading || (more && !this.state.nextCursor)) return;

    const revision = this.listRevision;
    this.update({ listLoading: true, listError: "" });

    try {
      const page = await api.list(more ? this.state.nextCursor! : undefined);

      if (revision !== this.listRevision) return;
      this.update({
        items: more ? mergeById(this.state.items, page.items) : page.items,
        nextCursor: page.nextCursor,
      });
    } catch (error) {
      this.update({ listError: errorText(error) });
    } finally {
      this.update({ listLoading: false });
    }
  };

  loadHistory = async (id: string, more = false) => {
    if (this.historyRequests.has(id)) return;

    const cursor = more ? this.state.views[id]?.nextCursor : undefined;
    if (more && !cursor) return;

    const revision = this.runner.revision;
    this.historyRequests.add(id);
    this.update({ loading: { ...this.state.loading, [id]: true } });

    try {
      const history = await api.history(id, cursor ?? undefined);

      if (revision !== this.runner.revision) return;
      const existing = this.state.views[id];
      const messages =
        more && existing ? mergeHistory(history.messages, existing.messages) : history.messages;

      this.update({
        views: { ...this.state.views, [id]: { ...history, messages } },
        errors: { ...this.state.errors, [id]: "" },
      });
      this.runner.reconcile(history);
    } catch (error) {
      this.update({ errors: { ...this.state.errors, [id]: errorText(error) } });
    } finally {
      this.historyRequests.delete(id);
      this.update({ loading: { ...this.state.loading, [id]: false } });
    }
  };

  send = async () => {
    const id = this.state.selected;
    const input = id ? (this.state.drafts[id] ?? "") : "";

    if (
      !id ||
      !input.trim() ||
      !this.state.ready ||
      this.state.loading[id] ||
      !this.state.views[id] ||
      this.state.views[id]?.syncState !== "ready" ||
      this.state.errors[id] ||
      isBusy(this.state.active?.phase)
    )
      return;

    if (new TextEncoder().encode(input).length > 8192) {
      this.update({
        errors: { ...this.state.errors, [id]: "Message text must not exceed 8 KiB." },
      });
      return;
    }

    await this.runner.send(
      id,
      input,
      this.state.views[id]!.messages.map((message) => message.id),
    );
  };

  cancel = () => this.runner.cancel();

  refresh = async (force = false) => {
    if (this.refreshing) return;
    this.refreshing = true;

    try {
      let connection = "Connected";
      const ready = await api.ready().catch((error) => {
        connection =
          error instanceof ApiError && error.code === "RECOVERING"
            ? "Synchronizing…"
            : "Agent unavailable · check setup";
        return false;
      });
      this.update({ ready, connection });

      if (ready && (!this.state.items.length || this.state.listError || force))
        await this.loadList();

      if (!this.runner.streaming) {
        const id = this.state.active?.conversationId ?? this.state.selected;
        if (
          id &&
          (force ||
            this.state.active ||
            !this.state.views[id] ||
            this.state.views[id]?.syncState === "uncertain" ||
            this.state.errors[id])
        ) {
          await this.loadHistory(id);
        }
        if (force && this.state.selected && this.state.selected !== id)
          await this.loadHistory(this.state.selected);
      }
    } catch {
      this.update({
        ready: false,
        connection: "Agent unavailable · check Docker and device approval",
      });
    } finally {
      this.refreshing = false;
    }
  };

  private tick = async () => {
    if (!this.started) return;
    if (document.visibilityState !== "hidden") await this.refresh();

    if (this.started) {
      clearTimeout(this.timer);
      const id = this.state.active?.conversationId ?? this.state.selected;
      const retry = !this.state.ready || this.state.listError || (id && this.state.errors[id]);
      this.timer = setTimeout(this.tick, retry ? 10_000 : 3000);
    }
  };

  private visible = () => {
    if (document.visibilityState === "visible") {
      clearTimeout(this.timer);
      void this.tick();
    }
  };

  start() {
    if (this.started) return;

    this.started = true;
    document.addEventListener("visibilitychange", this.visible);
    void this.tick();
  }

  close() {
    if (this.started) document.removeEventListener("visibilitychange", this.visible);
    this.started = false;
    clearTimeout(this.timer);
    this.runner.close();
  }
}
