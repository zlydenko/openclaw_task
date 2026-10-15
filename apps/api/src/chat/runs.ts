import { createHash } from "node:crypto";
import { mergeChatStreamMessage } from "@openclaw/gateway-client";

import { ApiError } from "../errors.ts";
import { conversationId, visibleMessage } from "../gateway/messages.ts";
import type { OpenClaw } from "../openclaw.ts";
import type {
  ChatEvent,
  JsonRecord,
  Run,
  RunLifecycle,
  StreamEvent,
  Submission,
  TerminalEvent,
  ToolEvent,
} from "../types.ts";

export class RunTracker {
  private requests = new Map<string, Run>();
  readonly active = new Map<string, Run>();

  constructor(
    private gateway: OpenClaw,
    private lifecycle: RunLifecycle,
  ) {}

  checkSubmission(id: string, requestId: string, message: string) {
    this.prune();

    const hash = createHash("sha256")
      .update(id + "\0" + message)
      .digest("hex");
    const previous = this.requests.get(requestId);

    if (previous) {
      throw new ApiError(
        409,
        previous.hash === hash ? "DUPLICATE_REQUEST" : "REQUEST_ID_REUSED",
        previous.hash === hash
          ? "This request was already submitted. Read history."
          : "Use a new request ID for different text.",
        { runId: previous.runId },
      );
    }

    if (this.active.has(id)) {
      throw new ApiError(409, "RUN_BUSY", "This conversation has an active or unresolved run.");
    }
    if (this.active.size >= 3) {
      throw new ApiError(409, "RUN_LIMIT", "Three conversations are already active or unresolved.");
    }

    return hash;
  }

  start(id: string, requestId: string, hash: string) {
    const run = this.fresh(id, requestId, hash);

    this.active.set(id, run);
    this.requests.set(requestId, run);

    return run;
  }

  adopt(id: string) {
    const run = this.fresh(id, null);

    run.accepted = true;
    run.uncertain = true;
    this.active.set(id, run);
  }

  accept(run: Run, runId: string) {
    run.runId = runId;
    run.accepted = true;
    this.emit(run, "accepted");

    const early = run.early;
    run.early = [];
    run.earlyBytes = 0;

    const earlyTools = run.earlyTools;
    run.earlyTools = [];

    // Settle tool snapshots before an early terminal chat event releases the run.
    for (const event of earlyTools) this.applyTool(run, event);
    for (const event of early) this.receive(event);
  }

  submission(run: Run): Submission {
    return {
      conversationId: run.conversationId,
      requestId: run.requestId,
      runId: run.runId,
      observe: (listener) => {
        run.observers.add(listener);

        if (run.activities.size)
          listener({
            event: "activity",
            data: {
              conversationId: run.conversationId,
              requestId: run.requestId,
              runId: run.runId,
              activities: [...run.activities.values()],
            },
          });
        if (run.last && run.last.event !== "accepted") listener(run.last);

        return () => {
          run.observers.delete(listener);
        };
      },
    };
  }

  interrupt(code: string, message: string, affected?: Run) {
    for (const run of affected ? [affected] : this.active.values()) {
      run.uncertain = true;
      for (const [id, activity] of run.activities) {
        if (activity.status === "running" || activity.status === "requested")
          run.activities.set(id, { ...activity, status: "unknown" });
      }
      this.emit(run, "failed", {
        code,
        message,
        outcomeUnknown: true,
        activities: [...run.activities.values()],
      });
    }
  }

  emit(run: Run, event: StreamEvent["event"], extra: JsonRecord = {}) {
    const update: StreamEvent = {
      event,
      data: {
        conversationId: run.conversationId,
        requestId: run.requestId,
        runId: run.runId,
        ...extra,
      },
    };

    if (event !== "activity") run.last = update;

    for (const observer of run.observers) observer(update);
  }

  finish(run: Run, event: TerminalEvent, extra: JsonRecord = {}) {
    if (run.done) return;

    run.done = true;
    run.uncertain = false;
    run.finishedAt = Date.now();

    for (const [id, activity] of run.activities) {
      if (activity.status === "running" || activity.status === "requested")
        run.activities.set(id, { ...activity, status: "unknown" });
    }
    this.emit(run, event, { text: run.text, activities: [...run.activities.values()], ...extra });

    if (this.active.get(run.conversationId) === run) {
      this.active.delete(run.conversationId);
      this.lifecycle.idle(run.conversationId);
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
      activities: new Map(),
      toolSeq: -1,
      earlyTools: [],
      early: [],
      earlyBytes: 0,
      observers: new Set(),
    };
  }

  receiveTool(event: ToolEvent) {
    for (const run of this.active.values()) {
      if (event.sessionKey && conversationId(event.sessionKey) !== run.conversationId) continue;
      if (run.accepted && event.runId !== run.runId) continue;
      this.applyTool(run, event);
    }
  }

  private applyTool(run: Run, event: ToolEvent) {
    if (run.done) return;

    if (!run.accepted) {
      if (run.earlyTools.length < 32) run.earlyTools.push(event);
      else {
        run.uncertain = true;
        this.lifecycle.uncertain();
      }
      return;
    }
    if (event.runId !== run.runId || event.seq <= run.toolSeq) return;
    run.toolSeq = event.seq;

    if (!run.activities.has(event.activity.id) && run.activities.size >= 128) {
      this.interrupt(
        "ACTIVITY_LIMIT",
        "Tool activity exceeded the display limit. Read history.",
        run,
      );
      return;
    }
    const previous = run.activities.get(event.activity.id);
    const activity = { ...previous, ...event.activity };
    // A later start/policy frame cannot erase an observed terminal result.
    if (
      previous &&
      ["completed", "failed"].includes(previous.status) &&
      activity.status === "running"
    )
      activity.status = previous.status;
    run.activities.set(activity.id, activity);
    this.emit(run, "activity", { activities: [...run.activities.values()] });
  }

  receive(event: ChatEvent) {
    const run = this.active.get(conversationId(event.sessionKey) ?? "");

    if (!run || conversationId(event.sessionKey) !== run.conversationId || run.done) return;

    if (!run.accepted) {
      const bytes = Buffer.byteLength(JSON.stringify(event));

      if (run.early.length < 16 && run.earlyBytes + bytes <= 256 * 1024) {
        run.early.push(event);
        run.earlyBytes += bytes;
      } else {
        run.uncertain = true;
        this.lifecycle.uncertain();
      }
      return;
    }

    if (event.runId !== run.runId || event.seq <= run.seq) return;

    const gap = run.seq >= 0 && event.seq > run.seq + 1;
    run.seq = event.seq;

    if (gap) {
      run.uncertain = true;
      this.lifecycle.recover();
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
}
