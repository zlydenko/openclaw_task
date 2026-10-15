import { GatewayClientRequestError } from "@openclaw/gateway-client";

import { Conversations } from "./chat/conversations.ts";
import { recoverGateway } from "./chat/recovery.ts";
import { RunTracker } from "./chat/runs.ts";
import { ApiError } from "./errors.ts";
import type { OpenClaw } from "./openclaw.ts";
import type { ImageAttachment, Page, Submission } from "./types.ts";

export class Chat {
  readonly owner = "local";
  private conversations: Conversations;
  private runs: RunTracker;
  private recovering: Promise<void> | null = null;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private reconcileTimer: ReturnType<typeof setInterval>;
  private stopped = false;
  ready = false;

  constructor(private gateway: OpenClaw) {
    this.conversations = new Conversations(gateway);
    this.runs = new RunTracker(gateway, {
      idle: (id) => {
        void gateway.unsubscribe(id).catch(() => {});
        if (
          gateway.authenticated &&
          !this.stopped &&
          !this.recovering &&
          ![...this.runs.active.values()].some((run) => run.uncertain)
        )
          this.ready = true;
      },
      uncertain: () => {
        this.ready = false;
      },
      recover: () => {
        void this.recover();
      },
    });

    gateway.onConnected(() => {
      void this.recover();
    });
    gateway.onDisconnected(() => {
      this.ready = false;
      this.runs.interrupt("GATEWAY_OFFLINE", "Connection lost. Read history before sending again.");
    });
    gateway.onGap(() => {
      if (this.runs.active.size) void this.recover();
    });
    gateway.onEvent((event) => this.runs.receive(event));
    gateway.onTool((event) => this.runs.receiveTool(event));

    this.reconcileTimer = setInterval(() => {
      if (
        gateway.authenticated &&
        [...this.runs.active.values()].some(
          (run) => run.uncertain || Date.now() - run.startedAt > 180_000,
        )
      ) {
        void this.recover();
      }
    }, 5000);
    this.reconcileTimer.unref();
  }

  get reason() {
    return this.gateway.authenticated ? "RECOVERING" : this.gateway.reason;
  }

  // Replace this fixed owner lookup when accounts and separate gateways are added.
  private resolveInstance(owner: string) {
    if (owner !== this.owner) throw new ApiError(404, "NOT_FOUND", "Instance not found.");

    return this.gateway;
  }

  private requireConnection() {
    if (!this.resolveInstance(this.owner).authenticated) {
      throw new ApiError(503, "GATEWAY_UNAVAILABLE", "The gateway is not ready.");
    }
  }

  private requireReady() {
    this.requireConnection();

    if (!this.ready) throw new ApiError(503, "GATEWAY_UNAVAILABLE", "The gateway is not ready.");
  }

  create() {
    this.requireReady();

    return this.conversations.create();
  }

  list(page: Page) {
    this.requireReady();

    return this.conversations.list(page);
  }

  async history(id: string, page: Page) {
    this.requireConnection();

    await this.conversations.known(id, this.runs.active.get(id));

    const history = await this.conversations.history(id, page, this.runs.active.has(id));
    const run = this.runs.active.get(id);

    return {
      ...history,
      activeRun: run ? { runId: run.runId, requestId: run.requestId } : null,
      syncState: !this.ready || run?.uncertain ? "uncertain" : "ready",
    };
  }

  async send(
    id: string,
    requestId: string,
    message: string,
    attachments?: ImageAttachment[],
  ): Promise<Submission> {
    const hash = this.runs.checkSubmission(id, requestId, message, attachments);

    this.requireReady();

    // Reserve before the first await. HTTP middleware cannot enforce this invariant.
    const run = this.runs.start(id, requestId, hash);

    try {
      await this.conversations.known(id);
      await this.gateway.subscribe(id);

      const result = await this.gateway.send(
        id,
        requestId,
        message,
        () => {
          run.sent = true;
        },
        attachments,
      );

      if (!result.runId) throw new Error("Missing acknowledgement");

      this.conversations.accepted(id);
      this.runs.accept(run, result.runId);

      return this.runs.submission(run);
    } catch (error) {
      if (!run.sent || error instanceof GatewayClientRequestError) {
        this.runs.finish(run, "failed", {
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
    const run = this.runs.active.get(id);

    if (!run || run.conversationId !== id || run.runId !== runId) {
      throw new ApiError(404, "RUN_NOT_FOUND", "Active run not found.");
    }

    this.requireConnection();

    await this.gateway.cancel(id, runId);

    return { runId, cancellationRequested: true };
  }

  private recover() {
    if (this.recovering) return this.recovering;

    this.ready = false;
    this.recovering = recoverGateway(
      this.gateway,
      this.runs,
      this.conversations,
      () => this.stopped,
    )
      .then((ready) => {
        this.ready = ready && !this.stopped && this.gateway.authenticated;
      })
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

  close() {
    this.stopped = true;
    this.ready = false;
    clearInterval(this.reconcileTimer);
    clearTimeout(this.recoveryTimer);

    this.runs.interrupt("SERVER_STOPPING", "The backend is stopping. Read history after restart.");
  }
}
