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

## F05 A profile update failed because apply_patch input was invalid

Finding date: 2026-10-15.
Verified release: OpenClaw 2026.10.3.
Conversation: 75b30834-dcf0-4b5e-a0ed-37740895ced2.

### Observed result

The user asked the agent to save a profile fact.
The read tool successfully read USER.md.
The agent then called apply_patch with an ordinary unified diff inside a Begin Patch envelope.
Its first operation line started with --- a/home/node/.openclaw/workspace/USER.md.
The tool executed and returned isError: true.
It rejected line 2 because it required an Add File, Delete File, or Update File header.

The required update header was:

```text
*** Update File: /home/node/.openclaw/workspace/USER.md
```

No corrected patch or successful write appeared later in that turn.
The final answer reported that the save failed.
A later read of the daily memory file did not find the requested fact.
The transcript does not establish why the agent did not repair the invalid input.
This failure was a patch-format error. It was not evidence of a denied tool permission.

This differs from F02's streamed function-name error.
That error also recurred in conversation 47f58618-f1b5-4728-8ac1-b515b56bfc9d:
Responses stream changed tool-call function name from edit to functions_edit.
The edit failed before execution. Other tools succeeded in a later turn.
The log identifies a transport consistency failure. It does not identify which upstream component changed the name.

### Follow-up

Keep these failure classes separate when reporting errors.
A later agent instruction or outcome evaluation can check correct patch syntax and recovery from rejected input.
Do not make the application silently retry a write or report that a failed operation succeeded.
No gateway setting or tool permission was changed for this finding.

Source: [OpenClaw apply_patch format](https://docs.openclaw.ai/tools/apply-patch).

## F06 Tool calls appear as unsupported content in the chat interface

Finding date: 2026-10-15.
Evidence: saved gateway transcripts and the current backend and frontend code.

### Cause and visible effect

The backend's visibleMessage function treats toolCall blocks as unsupported content.
Its projectMessages function keeps user and assistant rows only.
It drops toolResult rows, including the success or error outcome.
The frontend then shows Some content cannot be displayed in this text chat.
A tool-only assistant row becomes an empty OpenClaw message with that notice.
This notice is generated by our application. It is not a gateway error message.

In conversation c2302635-8262-4537-85f3-1f7ad4b4c4ce, sessions_search succeeded.
The interface still showed the notice because the assistant message contained a toolCall block.
The agent retrieved earlier conversation text. This did not prove that it read a saved memory file.
In F05's conversation, read succeeded and apply_patch failed.
Both actions produced the same generic display warning.
The interface therefore hides the distinction between a successful action and a failed action.

Relevant files:

- [Backend message projection](../apps/api/src/gateway/messages.ts)
- [Frontend message display](../apps/web/src/components/Messages.tsx)
- [Gateway event handling](../apps/api/src/openclaw.ts)

### Proposed improvement: show tool activity

Status: proposal only. No runtime or interface change is included in this finding.

Show a compact Activity list beside the assistant's text for each turn.
Show the tool name, a safe target summary when available, and its status.
For the failed profile update, the list would show:

```text
Read USER.md             Completed
Update USER.md          Failed: invalid patch format
```

Use an expandable row for a short result or error detail.
Keep the exact tool name, such as apply_patch, visible in that detail.
Use explicit states: Requested, Running, Completed, Failed, and Outcome unknown.
A recorded tool request alone does not prove that execution started.
Mark success only when a matching result confirms it.
A completed agent run does not prove that every tool succeeded.

Use the official client's TOOL_EVENTS capability for live activity.
The installed 2026.10.3 protocol package includes this capability.
Keep CHAT_ONLY_ASSISTANT_TEXT so that assistant text has one display source.
Official documentation states that this setting preserves other agent streams, including tools.
Handle the pinned release's tool events through the existing backend gateway connection.
Match events to the application conversation, run, and tool-call ID.
Check the exact event payloads before implementation; AgentEvent.data is an open record in the installed schema.
Observe the active run even when the user opens another conversation.

Send normalized activity updates through the existing HTTP/SSE path.
The current stream writer coalesces text snapshots and treats other events as terminal.
Add explicit handling for non-terminal activity updates with bounded storage.
Do not let a tool event close the stream or overwrite the latest text snapshot.

Project toolCall and matching toolResult entries into the same activity model for saved history.
Confirm their availability through the official history RPC before implementation.
Handle duplicate events and calls or results split across history pages.
If a result is unavailable after recovery, show Outcome unknown.
Use gateway history as the saved record. Do not add a second transcript database.

Replace known tool-content warnings with activity rows.
Remove empty rows that contain only hidden reasoning.
Retain a notice for content types that the interface still cannot display.
Do not display hidden reasoning, credentials, or arbitrary raw tool arguments and output.
Allow only selected detail fields. Limit and redact text before it reaches the browser.
Unknown tools can show their name and status without unsafe details.

Check a successful read and a failed patch through the full HTTP/SSE path.
Also check refresh, conversation navigation, duplicate events, and hidden credentials.
Use controlled integration responses first. Live model checks still require an agreed budget.
The display change will expose tool outcomes. It will not repair F02 or F05 by itself.

Sources:

- [Official client capabilities](https://docs.openclaw.ai/gateway/protocol/handshake#client-capabilities)
- [Official event streams and text projections](https://docs.openclaw.ai/gateway/protocol/rpc-bootstrap-and-events)



## F07 Official automatic conversation titles require an interactive session key

Finding date: 2026-10-15.
Inspected release: OpenClaw 2026.10.3. Wire protocol: 4.

### Cause

The application used agent:main:assessment-api-<uuid> session keys.
The pinned gateway only schedules automatic dashboard titles for keys whose agent-local part starts with dashboard:, ios-, or node-.
The application prefix did not qualify.
Reading sessions.list with includeDerivedTitles does not start title generation.
The backend also omitted the saved displayName field from its title projection.

### Official behavior

OpenClaw schedules naming in the background after chat.send admits an interactive turn.
It uses the first non-command message, bounded to 1,000 characters.
Its title prompt requests 3–6 words, at most 60 characters, in the message language.
It saves the result in displayName and emits sessions.changed with reason chat.title.
A saved custom label or existing explicit name takes precedence.
Later messages do not replace that name.

The gateway can use agents.defaults.utilityModel or its per-agent override.
Without an available alternate utility route, normal dashboard naming can use the regular session model.
Failed generation can use the native fallback and retry rules, then a two-word crustacean name.
These are gateway rules. The application adds no title retry loop.
Title generation makes separate paid provider requests.
No new provider, model, or utility-model setting was added for this feature.

The official sessions.title.prepare RPC is another option for client-prepared titles.
It returns a title without creating a session or starting a chat turn.
It uses the utility route only and can return null.
This application uses automatic chat naming instead.
It does not send draft text for speculative naming.

### Implemented behavior

New conversations use agent:main:dashboard:assessment-api-<uuid>.
Their first accepted message now qualifies for the gateway's automatic naming flow.
Empty conversations remain in memory and have no generated name.
The backend selects a custom label first, then displayName, then derivedTitle.
The browser refreshes names through read-only list requests on its existing visible-tab timer.
It retains the selection and loaded list pages during these refreshes.

Old application conversations retain their keys and history.
Roster discovery records their legacy routing before history, subscription, send, and cancellation requests.
Text and tool events accept both application prefixes and retain run-ID checks.
There is no paid backfill or session-key migration for old conversations.
No browser or backend message POST is replayed to obtain a name.

### Verification and limits

Controlled integration checks cover the native key prefix, unnamed empty conversations, title projection, custom-name precedence, legacy routing and events, delayed title refresh, and retained list pagination.
These fixtures supply generated metadata. They do not prove provider title generation.
TypeScript, Oxlint, Oxfmt, all 21 integration checks, and the production build passed.
Runtime checks and the paid-check limit are recorded in [verification](verification.md#conversation-titles--2026-10-16).
No paid title or chat request was made for this change.
A live check of generated wording and timing remains unverified.

### Sources

- Pinned image distribution: dist/dashboard-session-title-mitw4dGu.mjs (source: src/gateway/dashboard-session-title.ts).
- Pinned image distribution: dist/chat-send-handler-DdTqJY-G.mjs (source: src/gateway/server-methods/chat-send-background.ts).
- Installed official protocol package: SessionsTitlePrepareParams and SessionsCreateParams in @openclaw/gateway-protocol/protocol.schema.json.
- [Official session names](https://docs.openclaw.ai/web/control-ui/sessions-and-sidebar#new-session-names)
- [Official utility model configuration](https://docs.openclaw.ai/gateway/config-agents/models)
- [Official session RPCs](https://docs.openclaw.ai/gateway/protocol/rpc-session-control)


## F08 Native naming failed and legacy sessions had no derived title

Finding date: 2026-10-15.
Verified release: OpenClaw 2026.10.3. Wire protocol: 4.

### Observed result

The user still saw unnamed conversations after F07.
Read-only gateway inspection found 12 saved application sessions.
The new dashboard session had displayName and derivedTitle set to oceanic-crab.
The gateway logged: dashboard session title generation exhausted; using a crustacean fallback name.
The other 11 legacy sessions had no label, displayName, or derivedTitle.
Requesting includeLastMessage returned previews but did not restore their derived titles.
The new session's random name was present in the HTTP API when inspected.
The gateway log did not identify the underlying provider failure.

F07 established eligibility and metadata projection. It did not prove useful generated titles.
The old sessions were deliberately not sent for paid backfill in that change.
The controlled title fixtures did not cover the observed empty metadata or failed-generation result.

### Correction

Keep native automatic naming for new dashboard sessions.
Add a deterministic display fallback from saved user text.
Use the first sentence when available, limited to 60 Unicode characters with an ellipsis when needed.
Read the oldest 20 messages. If the first read contains only a later page, use totalMessages to request the oldest page.
Select visible user text only. Do not use assistant text, tool output, or hidden reasoning.
Cache up to 512 fallback titles and share pending reads.
Do not cache empty or failed reads, because an accepted first input can arrive later.

A custom label retains priority, including a custom label that resembles a random slug.
Useful saved generated names also retain priority and can replace the fallback on a later refresh.
Recognize native crustacean fallback slugs using the pinned adjective and crustacean vocabulary.
Use the user-text excerpt instead of that random name when source text is available.

This fallback is a text excerpt, not an AI summary.
It changes only the application projection. It does not rename gateway sessions or rewrite history.
It works for saved legacy sessions without a paid backfill request.
It can be reconstructed from the gateway's retained messages after an API restart.
The original F07 evidence remains above as a record of the earlier implementation.

### Verification

TypeScript, Oxlint, Oxfmt, all 21 integration checks, and the production build passed.
The integration fixture now covers missing legacy metadata, oldest-page selection, native failure slugs, custom-name priority, cached reads, and later useful generated names.
The rebuilt local API returned nonempty titles for all 12 saved conversations.
Two successive list reads returned the same titles.
After an API restart, all 12 titles were unchanged.
Compose validation, gateway configuration validation, health, and authenticated readiness passed.
No paid model request was made for diagnosis or verification.
The cause of the native generation failure remains unresolved.

Sources:

- Read-only sessions.list and chat.history results from the running gateway.
- Gateway log at 2026-10-16 07:10:46 UTC.
- Pinned dist/conversation-label-generator-CJJ75isK.mjs: bounded label attempts and suppressed failure details.
- Pinned dist/session-slug-DsU90tbm.mjs: native fallback vocabulary.


## F09 Keep first-message excerpts for conversation titles

Decision date: 2026-10-15.

The user confirmed that the first-message excerpts are sufficient for this stage.
Keep the current title implementation.
It selects the first sentence of saved user text and truncates it to 60 Unicode characters when needed.
This operation uses no model inference and is not a semantic summary of the conversation.

A concise topic summary would require a model inference request.
That request can use the configured Kimi model through the existing OpenRouter provider.
A separate external provider is not required.
OpenClaw also supports a utilityModel for short tasks such as title generation.
A smaller utility model can reduce latency and cost, but it remains an optional improvement.
Each generation request can use paid provider credit.

No utility model or paid title backfill was added.
No paid model request was made during this review.
The existing native naming configuration and saved-name priority remain unchanged.
F08 records the observed native failure and the verified excerpt fallback.
This decision updates documentation only.

Sources:

- [Official utility model configuration](https://docs.openclaw.ai/gateway/config-agents/models)
- [Official session naming](https://docs.openclaw.ai/web/control-ui/sessions-and-sidebar#new-session-names)

## F10 Memory save ended without a tool call

Finding date: 2026-10-15.
Conversation: f48b8dba-395d-46d3-9f85-ec4fa6bb33cd.

The agent promised to save North, then ended the turn without a tool call.
The follow-up did the same. Saved memory files did not contain North.
The transcript records stopReason: stop for both visible replies.
The interface marks the gateway's final event Complete; this does not confirm task success.

Gateway logs show a missing MEMORY.md read and two reasoning-only recovery attempts.
Two OpenRouter HTTP 400 responses also occurred while background title generation failed.
Their error bodies were not logged, so their relation to the missing write is unresolved.
No write attempt or write-permission error was recorded. The underlying cause remains unknown.

Evidence: saved gateway transcript, Docker logs, and the internal gateway log.
No paid model request or runtime change was made during diagnosis.

## F11 Strict browser networking limits normal public website access

Finding and decision date: 2026-10-16.
Gateway release: OpenClaw 2026.10.3, using the digest-pinned official browser image.

### Observed behavior

Chromium started with its namespace and seccomp sandboxes enabled.
HTTPS navigation and snapshots worked for a public IP URL.
The browser executable was therefore available; the remaining restriction came from the native network policy.

With browser.ssrfPolicy.dangerouslyAllowPrivateNetwork set to false, a normal domain URL was rejected.
The pinned navigation guard reports that it cannot guarantee DNS rebinding protection for hostname-based navigation.
It requires an IP-literal URL or an explicit trusted-host exception.

The local managed tab-open path also rejected a public IP URL because strict policy requires Playwright-backed redirect inspection.
Opening about:blank, then using the native navigate command, reached https://1.1.1.1/cdn-cgi/trace.
The saved snapshot contained the expected page marker.
This check did not establish general public-domain browsing.

### Investigated alternative

A temporary experiment used a separate Chromium container with network_mode: none.
Unix sockets carried CDP control and mandatory forward-proxy traffic.
The Node proxy used OpenClaw's official address policy to validate all DNS answers and pin connections to those answers.

Six offline checks passed for private and special-use addresses, DNS pinning and mixed answers, HTTP redirects and numeric loopback aliases, CONNECT tunnels, WebSocket upgrades, and resolution failure.
Direct Chromium/CDP checks in credential-free containers reached a normal HTTPS domain.
Private IPs, local and Docker service names, metadata, redirects to private targets, page fetches, and WebSockets were blocked.
Direct TCP connections had no route. Stopping the proxy blocked further browsing.

These were prototype checks. The alternative was not activated through the running OpenClaw gateway.
No paid model request was made.

### Decision and limits

The alternative required setting the native dangerouslyAllowPrivateNetwork flag to true and delegating address enforcement to the isolated browser and custom proxy.
The flag alone would permit private-network access.
Automatic approval review rejected that persistent change because it would replace the native protection boundary.

The user declined the change and asked to skip it.
The draft proxy, extra browser service, socket transport, and related configuration were removed.
The native managed Chromium setup and strict policy remain in place.
No saved gateway security setting was relaxed. Conversation and device volumes were not changed.

Normal public-domain browsing remains limited by this release's strict policy.
Exact trusted-host exceptions require separate trust decisions and maintenance.
The README records the trade-offs. No changelog entry was added for this investigation.

Evidence:

- Native browser CLI results and the inspected pinned navigation-guard.ts, server-context.tab-ops.ts, and routes/agent.snapshot.ts files.
- Temporary offline proxy tests and direct Chromium/CDP checks from 2026-10-16. The prototype code and test containers were removed.
- [Official browser control risk guidance](https://docs.openclaw.ai/gateway/security/browser-control).


## F12 File lookup used a wrong user path and stopped before reading daily memory

Finding date: 2026-10-16.
Conversation: a6a0d660-611e-4c6f-83c7-ddcc4802179f.
Gateway release: OpenClaw 2026.10.3.
Model route: OpenRouter, moonshotai/kimi-k2-thinking, openai-responses.

### Observed sequence

The request asked for the agent's current saved memories.
One assistant response requested four tools before receiving any tool results:

1. List /home/node/.openclaw/workspace.
2. List /home/node/.openclaw/workspace/memory.
3. Read /home/node/.openclaw/workspace/MEMORY.md.
4. Read /home/node/.openclaws/workspace/USER.md.

Both listings succeeded. The workspace listing contained USER.md and memory/.
The memory directory listing contained 2026-10-15.md.
MEMORY.md was absent. The USER.md read used an extra s in .openclaws and returned file not found.
The next assistant response ended with stopReason: error and no visible answer.
Its error was: Responses stream changed tool-call function name from read to functions_read.
The gateway logged the read failures at 08:31:14 UTC and the transport failure at 08:31:15 UTC.

### Why the user path was wrong

The incorrect absolute path is already present in the saved assistant tool-call arguments.
The read tool received that same literal path, as shown by its raw_params log.
The configured workspace is /home/node/.openclaw/workspace, without the extra s.
Three sibling tool calls in the same response used the correct workspace prefix.
The agent therefore had the correct prefix available but supplied an inconsistent path for one read.
It also issued the reads before it could use the directory listings to verify the targets.

This is consistent with a generated tool-argument typo. That attribution is an inference.
The saved transcript and tool log establish the bad argument and its execution, but do not isolate whether the model or provider-side conversion introduced it.
The evidence inspected for this review does not include a raw provider stream to establish that deeper cause.
The read operation used the supplied path and returned an error; it did not correct the spelling.
This evidence does not support a wrong workspace setting or a file-permission failure.

### Why existing daily memory was not compiled

The agent did check the memory directory. The missing step was reading its discovered files.
The initial tool batch guessed the conventional MEMORY.md path while also discovering daily notes.
A directory listing returns names, not file contents. It cannot supply the text needed for a memory summary.
The assistant needed a later model step to consume the listing and request memory/2026-10-15.md.
The continuation instead failed with the streamed tool-name consistency error.
No read of the daily file, memory_search call, memory_get call, or final summary was saved for this run.
The transcript does not show a completed decision to ignore the daily notes.
It shows discovery followed by a failed continuation.

MEMORY.md is an optional curated layer. Its absence does not mean the daily notes are empty or unavailable.
The workspace guidance distinguishes USER.md, daily notes, and curated MEMORY.md.
It does not require creating a unified file before existing daily notes can be read.
The absence of MEMORY.md explains one recoverable tool error. It does not explain or justify failure of the whole request.
The transport error prevented native correction of the bad path and further reads.
This repeats the streamed tool-name failure class recorded in F02.
The logs do not isolate which component of the model/provider/Responses integration changed the tool name.

### Expected behavior and limits

Use the configured workspace path consistently. Use successful discovery results to select existing files.
For a request to show saved memories, read the available permitted memory files and summarize their contents.
Report an absent curated MEMORY.md separately. Do not treat it as proof that no memory exists.
A missing-file result should allow a corrected read or an accurate partial answer through native agent recovery.
Do not replay tool events or message POST requests from the backend or browser to force recovery.

Read-only checks as gateway UID 1000 successfully read the correct USER.md and memory/2026-10-15.md.
Both files had mode 0600 and owner UID 1000. Their sizes were 1183 and 104 bytes.
Those checks establish filesystem readability. They do not prove successful model-driven recovery.
No runtime setting, memory file, conversation, or device identity was changed.
No paid model request was made. This finding records an unresolved behavior failure, not a verified fix.

Evidence:

- Native saved transcript for session 4517062f-e2d5-44d6-b77f-de6b97bf7ac5, events 4 through 10.
- Gateway logs for run 724aed88-0cc2-4bc5-a05f-612391119f2d at 2026-10-16 08:31:14-08:31:16 UTC.
- Saved agents.entries.main.workspace and the workspace AGENTS.md memory guidance.
- Read-only file checks inside the running gateway as its normal user.
- [Official workspace file and optional memory guidance](https://docs.openclaw.ai/concepts/agent-workspace).


## F13 Responses rejects inconsistent streamed and completed tool names

Finding date: 2026-10-16. Follow-up to F02 and F12.
Verified installed package: @openclaw/ai 2026.10.3.

### Confirmed mechanism

The Responses parser stores the function name from response.output_item.added.
It compares that name with the completed function-call name before accepting the call.
resolveCompletedResponsesToolCall trims both names and requires exact equality when both are present.
The observed read and functions_read names fail that comparison.
The parser rejects the call, then propagates the error at response completion.
The agent turn ends before another tool result or final answer can be produced.

An offline check used the installed validation function with synthetic calls.
read followed by read succeeded. read followed by functions_read reproduced the exact logged error.
No provider request or tool execution was involved in this check.
The check proves the rejection mechanism, not the origin of the inconsistent upstream names.

Kimi's published native tool-call ID format includes functions.<name>:<index>.
The functions_ prefix in the failed name is consistent with a namespace conversion problem.
That explanation remains an inference. A raw provider event trace is needed to isolate the faulty model-serving parser, OpenRouter conversion, or event correlation.
The saved error alone cannot assign the defect to one of those components.

### Fix options and trade-offs

The pinned native OpenRouter guide uses openai-completions-style transport.
Using that transport for Kimi is a candidate workaround for this Responses-specific check.
It is not yet a verified tool-reliability fix. F01 records delayed visible text on the earlier Chat Completions route.
A switch must verify the complete tool loop and visible answer streaming before it can satisfy both application requirements.

To retain Responses, the provider or adapter must supply one consistent canonical tool name across all events for a call.
Any compatibility correction must resolve names against the exact tools advertised in that request and reject ambiguous aliases or actual tool changes.
Removing the consistency check or blindly stripping functions_ from arbitrary names is not a verified correction.
No verified upstream release fix or configuration-only alias setting was established in this review.

A bounded opt-in live check must cover a file read, its result, and the final answer, plus visible streaming.
Changing transport also requires checking retained context. Account for separate native naming requests in the paid budget.
Do not replay accepted messages or tool events. Keep recovery inside OpenClaw.
No transport setting or upstream code was changed. No paid model call was made.

Sources:

- Installed /app/node_modules/@openclaw/ai/dist/openai-responses-shared-CKNmC3vC.mjs, resolveCompletedResponsesToolCall and processResponsesStream.
- Pinned image /app/docs/providers/openrouter.md and the historical live results in F01.
- [Upstream Responses name-consistency check](https://github.com/openclaw/openclaw/blob/main/packages/ai/src/transports/openai-responses-stream-terminal-internal.ts).
- [Moonshot Kimi K2 native tool-call format](https://github.com/MoonshotAI/Kimi-K2/blob/main/docs/tool_call_guidance.md#manually-parsing-tool-calls).


## F14 A model or serving-provider switch can avoid the tool-name failure but needs verification

Decision and evidence review date: 2026-10-16. Follow-up to F12 and F13.

The observed failure belongs to the current integration: Kimi K2 Thinking, its upstream serving provider, OpenRouter Responses, and the OpenClaw parser.
The read versus functions_read mismatch does not prove that the Kimi model itself is defective.
The component that introduced the inconsistent names remains unidentified.

A different model or a different provider serving Kimi can potentially avoid this conversion failure.
Moonshot reports differences in Kimi tool-call reliability between serving implementations and providers.
That supports testing another route. It does not prove that a specific replacement fixes this installation.
No replacement model or provider has been tested for this finding.

The user requires each visible answer fragment to reach the browser as soon as the provider emits it, subject to normal transport and rendering delay.
Holding generated answer text until completion is not acceptable.
Splitting a completed answer into artificial chunks does not satisfy this requirement.
F01 records buffering in the earlier Chat Completions route. Switching back alone is not an accepted fix.
Keep the working Responses streaming behavior while investigating the name-conversion fault, unless an alternative proves both tool use and immediate visible streaming.

Before adopting a replacement, verify these outcomes together:

1. The agent requests the correct file and the native tool reads it successfully.
2. The agent uses the result and completes its answer without a tool-name mismatch.
3. Visible answer fragments arrive during generation, without application buffering until completion.
4. Retained conversation context still works after any transport change.

A single successful request is evidence for that route, not a guarantee that all future tool calls succeed.
The wrong USER.md path in F12 is a separate tool-argument error. A model switch cannot guarantee correct paths on every call.
Keep normal missing-file handling and native recovery. Do not compensate with backend or browser replays.

This entry records an unverified fix option and the user's streaming requirement.
No model, provider, transport, or runtime setting was changed. No paid model request was made.
Live comparisons require explicit opt-in and a small paid budget, including native naming requests.

Source: [Moonshot K2 Vendor Verifier: provider differences in tool-call reliability](https://github.com/MoonshotAI/K2-Vendor-Verifier).


## F15 Browser discovery succeeded but the deferred tool was called directly

Finding and decision date: 2026-10-16.
Conversation: 4e17a60a-9199-4655-99b7-beebbc7f76f0.
Gateway release: OpenClaw 2026.10.3.
Model route: OpenRouter, moonshotai/kimi-k2-thinking, openai-responses.
Tool Search setting: tools.toolSearch = true.

### Observed sequence

The user asked the agent to open Wikipedia and take a screenshot of its main page.

1. The agent called tool_search with query "browser automation open website screenshot" and limit 5.
2. Search succeeded. Its first result was the browser tool, with ID openclaw:browser:browser.
3. The saved assistant call used the function name browser directly, with action open and targetUrl https://www.wikipedia.org.
4. The tool result was "Tool browser not found".
5. The assistant ended with a reply that browser automation was unavailable. No corrected tool_call was saved.

The browser action did not execute. This error occurred before Chromium navigation or network-policy checks.
The running container already had a Chromium executable. A missing browser package does not explain this failure.
Rebuilding the same image and configuration does not correct the observed dispatch error.

### Required dispatch behavior

With toolSearch set to true, this release selects the structured tools mode.
Discovered catalog tools must run through tool_call.
The browser result ID belongs in tool_call.id. Its action and targetUrl belong in tool_call.args.
Calling browser directly does not invoke the deferred catalog entry in this mode.

The installed tool-search implementation explicitly instructs the model that deferred names are not directly callable.
It directs calls through tool_call even when other guidance names the deferred tool directly.
The saved call did not follow that protocol.
The release documentation describes OpenClaw Tool Search as experimental.

### Cause and evidence limits

The transcript establishes the incorrect function name at the gateway execution boundary.
It does not establish which component introduced that name.
Copying the browser name from the search result is one possible explanation, but it remains an inference.
The evidence reviewed does not include the exact outbound provider tool schemas and raw returned provider events.
Those records are needed to distinguish a model selection error from provider conversion or OpenClaw adapter behavior.
This finding does not prove that Kimi itself is defective or that tool search is universally incompatible with it.
Configuration validation does not prove correct model tool invocation.

F12 through F14 record a separate streamed tool-name mismatch.
No common cause between that failure and this direct deferred-tool call has been established.
F11 records a separate strict network restriction that can still block Wikipedia after dispatch is corrected.

### Decision

Keep tool search enabled, as requested by the user.
Disabling tool search exposes direct tool schemas and can avoid this dispatch pattern.
That is a workaround, not an established diagnosis or the selected correction.
Reliable discovery, dispatch, result use, and native recovery remain unverified for this route.
The assistant's earlier statement that browser automation was unavailable was not supported by the successful discovery result.

This update records existing evidence only.
No configuration, model, provider, transport, or runtime setting was changed.
No paid model request or message replay was made. No changelog entry was added.

Evidence:

- Saved conversation history read through the official chat.history RPC and its safe application projection.
- Installed /app/docs/tools/tool-search.md.
- Installed /app/dist/tool-search-Bj3lDd5c.mjs, structured-mode capability-directory guidance.
