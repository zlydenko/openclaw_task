# Integration findings

## F01 Reasoning text can be held until completion

Finding date: 2026-10-14.
Verified release: OpenClaw 2026.10.3.
Wire protocol: 4.

### Observed result

The selected model is moonshotai/kimi-k2-thinking through OpenRouter.
The initial provider API setting was openai-completions.
The gateway completed answers but delivered only one large visible update near completion.
This failed the project's streaming check.

A direct OpenRouter diagnostic used stream: true with the same model.
It received HTTP 200 and 518 nonempty content updates.
The first content arrived at 20423 ms.
The response completed at 33954 ms.
This diagnostic isolated provider behavior.
It did not replace the gateway acceptance test.

Changing the gateway provider API to openai-responses restored visible streaming.
The model and provider remained the same.
One gateway run produced 52 visible updates.
The later context evaluation produced 127 visible updates.
See the recorded results for timing and verification limits.

### Mechanism in the pinned source

The shared Chat Completions stream processor detects reasoning in normalized provider output.
Its beginReasoning function sets openclawDelivery.textPhaseRequiresTerminal to true.
The agent subscriber checks this flag on Chat Completions messages.
When the flag is true, it withholds that text from live reply lanes.
The source explains that later reasoning can make preceding text interim.
Terminal classification determines the final answer phase.

The API detector accepts openai-completions and openclaw-openai-completions-transport.
These checks do not require a Kimi model name or an OpenRouter provider identifier.
The mechanism is shared code.
It is not a model-specific adapter rule.

### Scope and confidence

| Question                                                            | Finding                                                                                             | Evidence level                                           |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Is this limited to Kimi?                                            | No model-name restriction appears in this gate. Other models can enter it.                          | Source-based inference; Kimi was tested live.            |
| Is this limited to OpenRouter?                                      | No provider-name restriction appears in this gate. Other providers using this adapter can enter it. | Source-based inference; other providers were not tested. |
| Does every thinking model trigger it?                               | Not established. The guard depends on detected stream data and the terminal-classification flag.    | Source inspection; no cross-model live matrix.           |
| Does the model's reasoning: true setting alone prove this behavior? | No. The inspected gate tests message API and delivery state.                                        | Source inspection.                                       |
| Does Chat Completions inherently prevent streaming?                 | No. The direct OpenRouter diagnostic streamed content successfully.                                 | Live diagnostic for the selected route.                  |
| Are non-reasoning responses affected by this exact flag?            | Only if that flag is set. Other causes can still delay text.                                        | Source inspection; no universal streaming guarantee.     |
| Does Responses guarantee streaming for every model?                 | No. It passed for our selected route. Other routes require verification.                            | Live result limited to this setup.                       |

An OpenAI-compatible API name does not identify the upstream model vendor.
A third-party provider can use the same Chat Completions adapter.
The relevant combination is the OpenClaw version, adapter, and actual response stream.

A model can perform reasoning without returning reasoning content to this adapter.
Its display name alone does not establish the resulting delivery behavior.
Disabling reasoning display is not a verified fix.
We did not test reasoning suppression or disabled-thinking configurations.

Responses messages also have phase-dependent handling in the inspected subscriber.
Therefore, do not assume that changing the API removes every possible buffering condition.
Verify each new model, provider, or OpenClaw release with the live probe.

### Project decision

Keep the selected model and provider.
Use models.providers.openrouter.api = openai-responses.
Keep the upstream OpenClaw implementation unchanged.
Require multiple changed visible updates before the final event.
Do not count reasoning events as visible answer updates.
Do not split a completed answer into artificial chunks to claim streaming.

OpenRouter's Responses API is stateless.
OpenClaw supplies conversation context for this integration.
Context retention and separate-session history passed the live evaluation.

### Future verification

When changing the integration, record the gateway release, provider, model, and API.
Check authentication, visible streaming, final text, context, and session separation.
Record first-text time, completion time, and changed-update count.
Use one bounded request before running the larger context evaluation.
Keep source-based conclusions separate from live results.
Do not run a paid cross-provider test matrix without an agreed purpose and budget.

### Sources

- [Pinned stream processor: reasoning flag](https://github.com/openclaw/openclaw/blob/v2026.10.3/packages/ai/src/transports/openai-completions-stream.ts#L395-L409)
- [Pinned subscriber: live text guard](https://github.com/openclaw/openclaw/blob/v2026.10.3/src/agents/embedded-agent-subscribe.handlers.messages.update.ts#L208-L221)
- [Pinned subscriber: terminal classification](https://github.com/openclaw/openclaw/blob/v2026.10.3/src/agents/embedded-agent-subscribe.handlers.messages.update.ts#L323-L327)
- [Pinned API detector](https://github.com/openclaw/openclaw/blob/v2026.10.3/src/agents/embedded-agent-subscribe.handlers.messages.stream.ts#L57-L63)
- [OpenRouter Responses API](https://openrouter.ai/docs/api/reference/responses/overview)

## F02 Tool-call name changed during a Responses stream

Finding date: 2026-10-14.
The user asked the agent to show previous conversation history.
The connection succeeded, but the accepted model run failed.
The gateway reported this transport error:

Responses stream changed tool-call function name from tool_call to functions_tool_call.

This is a streamed function-name consistency error.
It is different from an explicit tool-policy rejection.
The gateway also logged an unsuccessful tool_describe request for list_directory.
The container reported no OOM kill and no restart.

The user requested available tool calls after this failure.
The gateway now uses the full profile without the blanket tools.deny list.
This permission change does not repair the observed transport error.
Tool transport compatibility remains unresolved.
No tool-call tests were added or run, as requested.

Automatic approval review rejected additional persistent execution and service changes.
The permitted change affects the tool catalog only.
Elevated execution, browser control, cron, and memory remain disabled.

## F03 Deferred discovery ended in a text-only recovery reply

Finding date: 2026-10-14.
The full tool profile was active for the reported turn.
The stored transcript showed these outcomes:

1. The model called sessions_list before discovery loaded that tool.
2. The runtime returned Tool sessions_list not found.
3. A later tool_search call succeeded and found openclaw:core:sessions_list.
4. The model did not execute sessions_list after discovery.
5. The final answer referred to a text-only step.

Tool execution was available because tool_search completed successfully.
The final wording matches OpenClaw's settled-tool recovery instruction.
That instruction requests a visible answer and removes tools for the recovery pass.
The transcript does not establish why the normal continuation ended after discovery.
This is distinct from F02's streamed tool-name consistency error.

The project now uses direct schemas for policy-permitted tools.
Both tools.toolSearch and tools.codeMode are false.
The full tool profile and existing permissions remain unchanged.
This removes the discovery dependency for sessions_list.
Configuration validation and gateway health checks passed.
No tests or paid model checks were added or run for this change.
Successful completion of the user's history request remains unverified.
Conversation visibility and requester ownership checks still apply.

Sources:

- [Pinned recovery instruction](https://github.com/openclaw/openclaw/blob/v2026.10.3/src/agents/embedded-agent-runner/run/incomplete-turn-recovery.ts)
- [Direct tool schemas](https://docs.openclaw.ai/tools/tool-search)

## F04 The backend accepts one active application run

Finding date: 2026-10-14.
This is an application design limit. It is not an OpenClaw protocol limit.

### Current behavior

The backend reserves one run slot across all application conversations.
While that run is active, another message submission returns 409 with RUN_BUSY.
The backend does not queue or steer the new message.
The same limit applies when the user switches to another conversation.
Live checks verified rejection of duplicate and concurrent sends.

The HTTP stream and the gateway run have separate lifetimes.
Closing the browser stream removes its response writer. It does not cancel the run.
The backend continues to observe the run and exposes known state through history.
This separation does not require a single-run limit. Queueing can use the same separation later.

An unknown outcome is different from a known active run.
For example, the gateway may accept a message before the connection loses its acknowledgement.
The backend must resolve that state before it admits more work.
A closed stream or elapsed transport timeout does not prove that the run stopped.
This prevents accidental repeat model calls and ambiguous conversation state.

### Future improvement: queued and steering input

Prefer the gateway's existing input modes before adding a separate queue service.
The pinned 2026.10.3 chat.send schema accepts queueMode values including followup and steer.

| Mode | Intended user behavior |
| --- | --- |
| Queue with followup | Accept another message now. Process it as a later turn after the current run ends. |
| Steer with steer | Add instructions to the active run when its runtime accepts steering. Otherwise, the input can wait for a later turn. |

Steering does not guarantee an immediate change and does not undo work already performed.
It is not the same as cancelling the current run and starting another one.
These modes have not been tested with this project's selected model and provider route.

Start with explicit followup input, then add steering as a separate user choice.
Show queued, running, consumed, cancelled, and uncertain input states.
Keep each submitted input ID separate from the execution run that eventually consumes it.
Bound pending input and provide cancellation for a specific queued input.
Restore pending inputs and receipts after reconnect or restart; activeRun alone is not sufficient.
Keep idempotency and ownership checks for every input.
Do not retry an input whose acceptance is unknown or place it into another queue automatically.

Review the global run slot when adding this behavior.
Use conversation and instance boundaries for admission, with a separate resource limit.
Preserve the current 2 GB WSL budget.
Implement and verify these changes in a later scope. The current backend behavior remains unchanged.

Sources:

- [Current backend contract](backend-prd.md#failure-and-recovery-rules)
- [Pinned chat input schema](https://github.com/openclaw/openclaw/blob/v2026.10.3/packages/gateway-protocol/src/schema/logs-chat.ts#L258-L328)
- [Gateway queue and steering behavior](https://docs.openclaw.ai/concepts/queue)
