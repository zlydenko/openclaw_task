import { conversationId } from "../gateway/messages.ts";
import type { OpenClaw } from "../openclaw.ts";
import { text, uuid } from "../validation.ts";
import type { History, Run } from "../types.ts";
import type { Conversations } from "./conversations.ts";
import type { RunTracker } from "./runs.ts";

async function activeConversations(gateway: OpenClaw, epoch: number) {
  const ids = new Set<string>();
  let offset = 0;

  while (true) {
    const roster = await gateway.roster(100, offset, true);

    for (const row of roster.sessions) {
      const candidate = conversationId(row.key);
      const active =
        row.hasActiveRun === true ||
        (Array.isArray(row.activeRunIds) && row.activeRunIds.length > 0);

      if (!candidate || !uuid.test(candidate) || !active) continue;
      ids.add(candidate);
    }

    const next = roster.nextOffset ?? offset + roster.sessions.length;
    const more = roster.hasMore === true || (roster.total !== undefined && next < roster.total);

    if (!more) return ids;

    if (next <= offset || !gateway.isCurrent(epoch)) {
      throw new Error("Roster changed during recovery");
    }

    offset = next;
  }
}

async function reconcileRun(
  run: Run,
  history: History,
  runs: RunTracker,
  conversations: Conversations,
) {
  if (runs.active.get(run.conversationId) !== run || run.done) return;

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

    conversations.accepted(run.conversationId);
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
    runs.finish(run, "failed", {
      code: "OUTCOME_UNAVAILABLE",
      message: "The run ended while observation was interrupted. Read history.",
      outcomeUnknown: true,
    });
  } else if (Array.isArray(activeIds) && run.runId && activeIds.includes(run.runId)) {
    run.uncertain = false;
  } else {
    run.uncertain = true;
  }
}

export async function recoverGateway(
  gateway: OpenClaw,
  runs: RunTracker,
  conversations: Conversations,
  isStopped: () => boolean,
) {
  const observed = new Map(runs.active);
  const epoch = await gateway.recoverSubscription();
  const ids = await activeConversations(gateway, epoch);

  if (!gateway.isCurrent(epoch) || isStopped()) return false;

  // Do not re-adopt a run that completed while the subscription or roster was pending.
  for (const id of ids) {
    if (!runs.active.has(id) && !observed.has(id)) runs.adopt(id);
  }

  for (const run of runs.active.values()) {
    await gateway.subscribe(run.conversationId);

    const sequence = run.seq;
    const history = await gateway.history(
      run.conversationId,
      50,
      0,
      run.runId ?? run.requestId ?? undefined,
    );

    if (!gateway.isCurrent(epoch)) return false;
    if (sequence === run.seq) await reconcileRun(run, history, runs, conversations);
  }

  return (
    gateway.isCurrent(epoch) &&
    !isStopped() &&
    ![...runs.active.values()].some((run) => run.uncertain)
  );
}
