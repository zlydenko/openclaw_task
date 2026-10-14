import { createHash, randomUUID } from "node:crypto";
import {
  OpenClaw,
  GatewayClientRequestError,
  mergeChatStreamMessage,
  conversationId,
  namespace,
  projectMessages,
  record,
  sessionKey,
  text,
  uuid,
  visibleMessage,
  type ChatEvent,
  type History,
} from "./openclaw.ts";

export class ApiError extends Error {
  constructor(
    public status: 400 | 404 | 409 | 413 | 503,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export type StreamEvent = {
  event: "accepted" | "message" | "completed" | "cancelled" | "failed";
  data: Record<string, unknown>;
};
type Run = {
  conversationId: string;
  requestId: string | null;
  runId: string | null;
  hash: string;
  sent: boolean;
  accepted: boolean;
  uncertain: boolean;
  done: boolean;
  startedAt: number;
  limited: boolean;
  finishedAt?: number;
  seq: number;
  message: unknown;
  text: string;
  last?: StreamEvent;
  early: ChatEvent[];
  earlyBytes: number;
  observers: Set<(event: StreamEvent) => void>;
};
export type Submission = Pick<Run, "conversationId" | "requestId" | "runId"> & {
  observe: (listener: (event: StreamEvent) => void) => () => void;
};
type Page = { limit: number; offset: number; emptyOffset: number };

export function pageFrom(limit?: string, cursor?: string, scope = "list"): Page {
  const size = limit === undefined ? 50 : Number(limit);
  if (!Number.isInteger(size) || size < 1 || size > 100)
    throw new ApiError(400, "INVALID_PAGE", "Use a limit from 1 to 100.");
  if (!cursor) return { limit: size, offset: 0, emptyOffset: 0 };
  try {
    if (cursor.length > 512) throw new Error();
    const data = record(JSON.parse(Buffer.from(cursor, "base64url").toString()));
    if (
      data.scope !== scope ||
      !Number.isSafeInteger(data.offset) ||
      Number(data.offset) < 0 ||
      !Number.isSafeInteger(data.emptyOffset) ||
      Number(data.emptyOffset) < 0
    )
      throw new Error();
    return { limit: size, offset: Number(data.offset), emptyOffset: Number(data.emptyOffset) };
  } catch {
    throw new ApiError(400, "INVALID_CURSOR", "The page cursor is invalid.");
  }
}
const cursorFor = (scope: string, offset: number, emptyOffset = 0) =>
  Buffer.from(JSON.stringify({ scope, offset, emptyOffset })).toString("base64url");

export class Chat {
  // This boundary will resolve an authenticated owner and gateway in a later stage.
  readonly owner = "local";
  private resolveInstance(owner: string) {
    if (owner !== this.owner) throw new ApiError(404, "NOT_FOUND", "Instance not found.");
    return this.gateway;
  }
  private empty = new Map<string, number>();
  private requests = new Map<string, Run>();
  private active: Run | null = null;
  private recovering: Promise<void> | null = null;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private reconcileTimer: ReturnType<typeof setInterval>;
  private stopped = false;
  ready = false;

  constructor(private gateway: OpenClaw) {
    gateway.onConnected(() => {
      void this.recover();
    });
    gateway.onDisconnected(() => {
      this.ready = false;
      if (this.active) {
        this.active.uncertain = true;
        this.emit(this.active, "failed", {
          code: "GATEWAY_OFFLINE",
          message: "Connection lost. Read history before sending again.",
          outcomeUnknown: true,
        });
      }
    });
    gateway.onGap(() => {
      if (this.active) void this.recover();
    });
    gateway.onEvent((event) => this.receive(event));
    this.reconcileTimer = setInterval(() => {
      if (
        this.active &&
        gateway.authenticated &&
        (this.active.uncertain || Date.now() - this.active.startedAt > 180_000)
      )
        void this.recover();
    }, 5000);
    this.reconcileTimer.unref();
  }

  get reason() {
    return this.gateway.authenticated ? "RECOVERING" : this.gateway.reason;
  }
  private available() {
    if (!this.ready || !this.resolveInstance(this.owner).authenticated)
      throw new ApiError(503, "GATEWAY_UNAVAILABLE", "The gateway is not ready.");
  }
  private emit(run: Run, event: StreamEvent["event"], extra: Record<string, unknown> = {}) {
    const update: StreamEvent = {
      event,
      data: {
        conversationId: run.conversationId,
        requestId: run.requestId,
        runId: run.runId,
        ...extra,
      },
    };
    run.last = update;
    for (const observer of run.observers) observer(update);
  }
  private finish(
    run: Run,
    event: "completed" | "cancelled" | "failed",
    extra: Record<string, unknown> = {},
  ) {
    if (run.done) return;
    run.done = true;
    run.uncertain = false;
    run.finishedAt = Date.now();
    this.emit(run, event, { text: run.text, ...extra });
    if (this.active === run) {
      this.active = null;
      if (this.gateway.authenticated && !this.stopped) this.ready = true;
    }
    this.prune();
    console.log(
      JSON.stringify({
        event: "run_finished",
        requestId: run.requestId,
        runId: run.runId,
        outcome: event,
        durationMs: Date.now() - run.startedAt,
      }),
    );
  }
  private prune() {
    const completed = [...this.requests.entries()].filter(([, run]) => run.done);
    for (const [id, run] of completed) {
      if (Date.now() - (run.finishedAt ?? 0) > 3600_000 || this.requests.size > 1000)
        this.requests.delete(id);
    }
  }
  private fresh(id: string, requestId: string | null, hash = ""): Run {
    return {
      conversationId: id,
      requestId,
      runId: null,
      hash,
      startedAt: Date.now(),
      limited: false,
      sent: false,
      accepted: false,
      uncertain: false,
      done: false,
      seq: -1,
      message: { role: "assistant", content: "" },
      text: "",
      early: [],
      earlyBytes: 0,
      observers: new Set(),
    };
  }

  create() {
    this.available();
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
    this.available();
    const empties = [...this.empty].sort((a, b) => b[1] - a[1]);
    const items: { id: string; title?: string; updatedAt?: number }[] = empties
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
  private async known(id: string, allowActive = true) {
    if (!uuid.test(id)) throw new ApiError(404, "NOT_FOUND", "Conversation not found.");
    if (this.empty.has(id) || (allowActive && this.active?.conversationId === id)) return;
    const result = await this.gateway.roster(10, 0, false, "assessment-api-" + id);
    if (result.sessions.some((row) => row.key === sessionKey(id))) return;
    throw new ApiError(404, "NOT_FOUND", "Conversation not found.");
  }
  async history(id: string, page: Page) {
    if (!this.gateway.authenticated)
      throw new ApiError(503, "GATEWAY_UNAVAILABLE", "The gateway is not ready.");
    await this.known(id);
    const history =
      this.empty.has(id) && this.active?.conversationId !== id
        ? {}
        : await this.gateway.history(id, page.limit, page.offset);
    const run = this.active?.conversationId === id ? this.active : null;
    return {
      id,
      messages: projectMessages(history.messages ?? []),
      nextCursor:
        history.hasMore && history.nextOffset !== undefined
          ? cursorFor(id, history.nextOffset)
          : null,
      activeRun: run ? { runId: run.runId, requestId: run.requestId } : null,
      syncState: !this.ready || run?.uncertain ? "uncertain" : "ready",
    };
  }

  async send(id: string, requestId: string, message: string): Promise<Submission> {
    this.prune();
    const hash = createHash("sha256").update(`${id}\0${message}`).digest("hex");
    const previous = this.requests.get(requestId);
    if (previous)
      throw new ApiError(
        409,
        previous.hash === hash ? "DUPLICATE_REQUEST" : "REQUEST_ID_REUSED",
        previous.hash === hash
          ? "This request was already submitted. Read history."
          : "Use a new request ID for different text.",
        { runId: previous.runId },
      );
    if (this.active)
      throw new ApiError(409, "RUN_BUSY", "A run is active or its outcome is uncertain.");
    this.available();
    // Reserve synchronously, before any gateway request or history read.
    const run = this.fresh(id, requestId, hash);
    this.active = run;
    this.requests.set(requestId, run);
    try {
      await this.known(id, false);
      await this.gateway.subscribe(id);
      const result = await this.gateway.send(id, requestId, message, () => {
        run.sent = true;
      });
      if (!result.runId) throw new Error("Missing acknowledgement");
      run.runId = result.runId;
      run.accepted = true;
      this.empty.delete(id);
      this.emit(run, "accepted");
      const early = run.early;
      run.early = [];
      run.earlyBytes = 0;
      for (const event of early) this.receive(event);
      return {
        conversationId: id,
        requestId,
        runId: run.runId,
        observe: (listener) => {
          run.observers.add(listener);
          if (run.last && run.last.event !== "accepted") listener(run.last);
          return () => {
            run.observers.delete(listener);
          };
        },
      };
    } catch (error) {
      if (!run.sent || error instanceof GatewayClientRequestError) {
        this.finish(run, "failed", {
          code: "SUBMISSION_REJECTED",
          message: "The gateway did not accept this message.",
          outcomeUnknown: false,
        });
      } else {
        run.uncertain = true;
        this.ready = false;
        void this.recover();
      }
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        run.uncertain ? "SUBMISSION_UNKNOWN" : "SUBMISSION_REJECTED",
        run.uncertain
          ? "Submission outcome is unknown. Read history. Do not repeat the request."
          : "The gateway did not accept this message.",
        { runId: run.runId, outcomeUnknown: run.uncertain },
      );
    }
  }

  async cancel(id: string, runId: string) {
    const run = this.active;
    if (!run || run.conversationId !== id || run.runId !== runId)
      throw new ApiError(404, "RUN_NOT_FOUND", "Active run not found.");
    if (!this.gateway.authenticated)
      throw new ApiError(503, "GATEWAY_UNAVAILABLE", "The gateway is not ready.");
    await this.gateway.cancel(id, runId);
    return { runId, cancellationRequested: true };
  }
  private receive(event: ChatEvent) {
    const run = this.active;
    if (!run || event.sessionKey !== sessionKey(run.conversationId) || run.done) return;
    if (!run.accepted) {
      const bytes = Buffer.byteLength(JSON.stringify(event));
      if (run.early.length < 16 && run.earlyBytes + bytes <= 256 * 1024) {
        run.early.push(event);
        run.earlyBytes += bytes;
      } else {
        run.uncertain = true;
        this.ready = false;
      }
      return;
    }
    if (event.runId !== run.runId || event.seq <= run.seq) return;
    const gap = run.seq >= 0 && event.seq > run.seq + 1;
    run.seq = event.seq;
    if (gap) {
      run.uncertain = true;
      void this.recover();
    }
    const merged = mergeChatStreamMessage(run.message, event);
    const visible = visibleMessage(merged);
    if (Buffer.byteLength(visible.text) > 64 * 1024) {
      if (!run.limited) {
        run.limited = true;
        run.uncertain = true;
        this.emit(run, "failed", {
          code: "ANSWER_LIMIT",
          message: "The answer exceeded the display limit. Read history.",
          outcomeUnknown: true,
        });
        void this.gateway.cancel(run.conversationId, event.runId).catch(() => {});
      }
      if (event.state === "final" || event.state === "aborted" || event.state === "error")
        this.finish(run, "failed", {
          code: "ANSWER_LIMIT",
          message: "The answer exceeded the display limit.",
          outcomeUnknown: false,
        });
      return;
    }
    run.message = { role: "assistant", content: visible.text };
    run.text = visible.text;
    if (event.state === "delta") this.emit(run, "message", { text: run.text });
    else if (event.state === "final") this.finish(run, "completed");
    else if (event.state === "aborted") this.finish(run, "cancelled");
    else if (event.state === "error")
      this.finish(run, "failed", {
        code: "RUN_FAILED",
        message: "The gateway could not complete this run.",
        outcomeUnknown: false,
      });
  }

  private async reconcile(run: Run, history: History) {
    if (this.active !== run || run.done) return;
    const activeIds = history.sessionInfo?.activeRunIds;
    const inFlight = history.inFlightRun;
    if (inFlight?.runId && (!run.runId || run.runId === inFlight.runId)) {
      run.runId = inFlight.runId;
      run.accepted = true;
      run.uncertain = false;
      const snapshot = text(inFlight.text);
      if (Buffer.byteLength(snapshot) <= 64 * 1024) {
        run.text = snapshot;
        run.message = { role: "assistant", content: snapshot };
      }
      this.empty.delete(run.conversationId);
      return;
    }
    const idle = Array.isArray(activeIds)
      ? activeIds.length === 0
      : history.sessionInfo?.hasActiveRun === false;
    const receipt = history.inputReceipts?.find(
      (item) => item.runId === (run.runId ?? run.requestId),
    );
    // Idle alone does not resolve an acknowledgement that may never have arrived.
    if (idle && (run.accepted || receipt?.state === "consumed")) {
      this.finish(run, "failed", {
        code: "OUTCOME_UNAVAILABLE",
        message: "The run ended while observation was interrupted. Read history.",
        outcomeUnknown: true,
      });
    } else if (Array.isArray(activeIds) && run.runId && activeIds.includes(run.runId))
      run.uncertain = false;
    else run.uncertain = true;
  }
  private recover() {
    if (this.recovering) return this.recovering;
    this.ready = false;
    this.recovering = this.recoverNow()
      .catch(() => {
        this.ready = false;
        if (!this.stopped && this.gateway.authenticated) {
          clearTimeout(this.recoveryTimer);
          this.recoveryTimer = setTimeout(() => {
            void this.recover();
          }, 3000);
          this.recoveryTimer.unref();
        }
      })
      .finally(() => {
        this.recovering = null;
      });
    return this.recovering;
  }
  private async recoverNow() {
    const observed = this.active;
    const epoch = await this.gateway.recoverSubscription();
    // A terminal event can arrive while the subscription RPC is pending.
    if (observed && this.active !== observed) {
      if (this.gateway.isCurrent(epoch) && !this.stopped) this.ready = !this.active?.uncertain;
      return;
    }
    if (!this.active) {
      const rows: { key: string }[] = [];
      let offset = 0;
      while (true) {
        const roster = await this.gateway.roster(100, offset, true);
        for (const row of roster.sessions) {
          if (
            row.key.startsWith(namespace) &&
            uuid.test(conversationId(row.key) ?? "") &&
            (row.hasActiveRun === true ||
              (Array.isArray(row.activeRunIds) && row.activeRunIds.length > 0))
          ) {
            rows.push(row);
            if (rows.length > 1) throw new Error("Multiple active sessions require review");
          }
        }
        const next = roster.nextOffset ?? offset + roster.sessions.length;
        const more = roster.hasMore === true || (roster.total !== undefined && next < roster.total);
        if (!more) break;
        if (next <= offset || !this.gateway.isCurrent(epoch))
          throw new Error("Roster changed during recovery");
        offset = next;
      }
      if (rows[0]) {
        const id = conversationId(rows[0].key)!;
        const run = this.fresh(id, null);
        run.accepted = true;
        run.uncertain = true;
        this.active = run;
      }
    }
    const run = this.active;
    if (run) {
      await this.gateway.subscribe(run.conversationId);
      const sequence = run.seq;
      const history = await this.gateway.history(
        run.conversationId,
        50,
        0,
        run.runId ?? run.requestId ?? undefined,
      );
      if (!this.gateway.isCurrent(epoch)) return;
      if (sequence === run.seq) await this.reconcile(run, history);
    }
    if (this.gateway.isCurrent(epoch) && !this.stopped) this.ready = !this.active?.uncertain;
  }
  close() {
    this.stopped = true;
    this.ready = false;
    clearInterval(this.reconcileTimer);
    clearTimeout(this.recoveryTimer);
    if (this.active)
      this.emit(this.active, "failed", {
        code: "SERVER_STOPPING",
        message: "The backend is stopping. Read history after restart.",
        outcomeUnknown: true,
      });
  }
}
