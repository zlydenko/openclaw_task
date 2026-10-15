import { api, ApiError } from "./api.ts";
import { isBusy } from "./state.ts";
import type { History, RunCallbacks, StreamEvent, Turn } from "./types.ts";

export class RunController {
  current: Turn | null = null;
  streaming = false;
  revision = 0;
  private abort?: AbortController;

  constructor(private callbacks: RunCallbacks) {}

  private update(patch: Partial<Turn>) {
    if (!this.current) return;

    this.current = { ...this.current, ...patch };
    this.revision++;
    this.callbacks.change(this.current);
  }

  async send(id: string, input: string, baselineIds: string[]) {
    if (this.streaming || isBusy(this.current?.phase)) return;

    this.current = {
      conversationId: id,
      requestId: crypto.randomUUID(),
      runId: null,
      input,
      text: "",
      phase: "sending",
      notice: "",
      baselineIds,
    };
    this.abort = new AbortController();
    this.streaming = true;
    this.update({});

    try {
      await api.send(
        id,
        this.current.requestId!,
        input,
        (event) => this.receive(event),
        AbortSignal.any([this.abort.signal, AbortSignal.timeout(215_000)]),
      );

      if (isBusy(this.current.phase)) {
        this.update({
          phase: "checking",
          notice: "The stream closed. The agent may still be working. Do not repeat this message.",
        });
      }
    } catch (error) {
      if (!isBusy(this.current?.phase)) return;

      const rejected =
        error instanceof ApiError &&
        !error.outcomeUnknown &&
        (error.status < 500 || ["SUBMISSION_REJECTED", "GATEWAY_UNAVAILABLE"].includes(error.code));

      this.update({
        phase: rejected ? "failed" : "checking",
        runId: error instanceof ApiError ? error.runId : this.current.runId,
        notice:
          error instanceof ApiError
            ? error.message
            : "Connection lost. The outcome is unknown. Do not repeat this message.",
      });
    } finally {
      this.streaming = false;
      this.callbacks.settled(id);
    }
  }

  private receive({ event, data }: StreamEvent) {
    const turn = this.current;

    if (!turn || data.conversationId !== turn.conversationId || data.requestId !== turn.requestId)
      return;
    if (turn.runId && data.runId !== turn.runId) return;
    if (!isBusy(turn.phase)) return;

    if (event === "accepted") {
      if (!data.runId) throw new Error("Missing run acknowledgement.");

      this.update({ runId: data.runId, phase: "thinking" });
      this.callbacks.accepted(turn.conversationId, turn.input);
      return;
    }

    if (!turn.runId) throw new Error("Response arrived before acknowledgement.");

    if (event === "message") {
      this.update({
        text: data.text ?? "",
        phase: turn.phase === "stopping" ? "stopping" : "responding",
      });
      return;
    }

    this.update({
      text: data.text ?? turn.text,
      phase: event === "failed" ? (data.outcomeUnknown ? "checking" : "failed") : event,
      notice:
        event === "failed" ? (data.message ?? "The agent could not complete this response.") : "",
    });
  }

  async cancel() {
    const turn = this.current;

    if (!turn?.runId || !isBusy(turn.phase) || turn.phase === "stopping") return;

    this.update({ phase: "stopping", notice: "" });

    try {
      await api.cancel(turn.conversationId, turn.runId);
    } catch (error) {
      if (this.current?.requestId !== turn.requestId || !isBusy(this.current.phase)) return;

      this.update({
        phase: "checking",
        notice: error instanceof Error ? error.message : "Cancellation could not be confirmed.",
      });
    } finally {
      if (!this.streaming) this.callbacks.settled(turn.conversationId);
    }
  }

  reconcile(history: History) {
    if (this.streaming) return;

    const turn = this.current;

    if (isBusy(turn?.phase) && turn?.conversationId !== history.id) return;

    if (history.activeRun) {
      const differentRun =
        turn?.runId && history.activeRun.runId && turn.runId !== history.activeRun.runId;
      const differentRequest =
        turn?.requestId &&
        history.activeRun.requestId &&
        turn.requestId !== history.activeRun.requestId;

      if (turn && isBusy(turn.phase) && (differentRun || differentRequest)) {
        this.update({
          phase: "checking",
          notice: "Another run is active here. The earlier outcome is still unknown.",
        });
        return;
      }

      if (!turn || turn.conversationId !== history.id || !isBusy(turn.phase)) {
        this.current = {
          conversationId: history.id,
          requestId: history.activeRun.requestId,
          runId: history.activeRun.runId,
          input: "",
          text: "",
          phase: "checking",
          notice: "A run is active. Its response will be recovered from history.",
          baselineIds: [],
        };
      }

      this.update({
        runId: history.activeRun.runId,
        phase: this.current?.phase === "stopping" ? "stopping" : "checking",
      });
    } else if (
      turn?.conversationId === history.id &&
      isBusy(turn.phase) &&
      history.syncState === "ready"
    ) {
      this.update({
        phase: "ended",
        notice:
          "The run is no longer active. Review history; its final outcome was not confirmed by this browser.",
      });
    }
  }

  close() {
    this.abort?.abort();
  }
}
