# Hono backend PRD (Product Requirements Document)

Defined in R2. Backend implementation is now authorized.
React remains deferred.

## Goal and scope

Let the React application send text to the Docker gateway and show answers as they arrive.
Support one trusted local user and one OpenClaw instance.


Use TypeScript, Hono on Node.js, and the official OpenClaw client.
Keep OpenRouter and `moonshotai/kimi-k2-thinking` configured in the gateway.
The backend must not call OpenRouter directly.

Include conversation creation, a conversation list, history, streamed answers, cancellation, and health.
Defer accounts, attachments, model selection, tool display, approval interfaces, and public hosting.
The agent can still use tools permitted by its gateway configuration.
Tool display and tool execution are separate concerns.

## Design defaults

| Choice | Decision |
| --- | --- |
| Services | Add one Hono container beside the existing gateway |
| Browser transport | POST a message and return SSE in that response |
| Gateway transport | One managed connection through the official client |
| Persistence | OpenClaw owns messages; a private backend volume holds device identity and its token |
| Concurrent work | One active application run in total; reject extra sends with 409 |
| Storage | No application database, queue service, or event log |
| Organization | Routes, one chat service, and one gateway adapter |

The frontend uses `fetch` to read the POST response stream.
A separate GET subscription supports native EventSource but adds subscription and replay coordination.
Do not add automatic message retries.

## HTTP contract

All application routes use the `/api` prefix.
All conversation IDs are server-issued UUIDs.
Return JSON except for a successful message submission.

| Method and path | Result |
| --- | --- |
| GET /health | 200 when the HTTP process can respond |
| GET /ready | 200 after gateway authentication and recovery; otherwise 503 with a safe reason |
| POST /api/conversations | 201 with `{ id }` for a new empty conversation |
| GET /api/conversations | 200 with `{ items, nextCursor }` |
| GET /api/conversations/:id | 200 with `{ id, messages, nextCursor, activeRun, syncState }` |
| POST /api/conversations/:id/messages | JSON body `{ requestId, text }`; 200 SSE after gateway acceptance |
| POST /api/conversations/:id/runs/:runId/cancel | 202 after the gateway accepts cancellation; this does not prove that the run stopped |

A list item contains `id`, an available title, and an available update time.
A history message contains a stable display ID, role, and visible text.
Mark unsupported content. Do not return reasoning or raw tool arguments and outputs.

Use opaque cursors for list and history pages. Default to 50 items; permit at most 100.
Bound history responses to 512 KiB and mark truncated text.
Translate gateway paging inside the adapter.

`activeRun` contains the known run ID and request ID when available.
`syncState` is `ready` or `uncertain`.
An unknown run outcome must remain uncertain until gateway state resolves it.

Create empty conversations in memory. They can disappear after a backend restart.
The gateway retains conversations after their first accepted message.
List only application conversations under a dedicated session namespace.
Existing terminal-client conversations remain available through the terminal client.

## Stream contract

Subscribe to gateway session events before sending a message.
Bind events to the conversation and acknowledged gateway run.
Keep a small bounded buffer for events that arrive before acknowledgement.

Each SSE data object contains `conversationId`, `requestId`, and `runId`.
Use these application event names:

| Event | Data and meaning |
| --- | --- |
| accepted | The gateway accepted the request |
| message | `text` contains the complete visible answer so far; replace the displayed answer |
| completed | `text` contains the final answer |
| cancelled | The gateway confirmed cancellation; partial text may remain |
| failed | `code`, safe `message`, and `outcomeUnknown` explain the failure |

Merge text with the official client helper before producing complete snapshots.
The UI replaces text instead of appending snapshots.
Ignore duplicate or older sequence values. Reload history after a sequence gap.

Send SSE comments about every 15 seconds. Disable response caching and buffering.
A live stream ends with one terminal event when delivery is possible.
If the connection closes without that event, the client must treat the outcome as unknown.
Do not create artificial chunks from an already completed answer.

## Failure and recovery rules

Require a client-generated UUID `requestId` and use it as the gateway idempotency key.
Remember the request and its content hash before submission.
For a repeated request ID, return 409 with the known run ID when available.
Reject reuse with different text.
Retain at most 1000 completed requests for one hour. Never evict unresolved requests.
Gateway deduplication has release-specific limits; permanent exactly-once execution across restarts is outside this scope.

Validate input and reserve the single run slot before making a paid request.
Reject new sends while gateway state or an earlier submission outcome is uncertain.
Do not queue work silently.

On browser disconnect, remove the response writer and keep tracking the run until its gateway timeout or terminal event.
The browser recovers through history and active-run state. It does not repeat the POST or resume an old stream.

On gateway disconnect, stop accepting messages and reconnect with bounded backoff.
Restore subscriptions and reconcile history and active runs before readiness returns.
Do not resend a message whose acknowledgement was lost or assume its run stopped.
Keep an unknown result visible if the gateway cannot resolve it.

Use the current 180-second gateway run timeout.
Allow up to 200 seconds for the HTTP stream.
A transport timeout closes observation; it does not prove cancellation.
Release the run slot only after a known terminal outcome or reconciliation that proves the run is no longer active.
If cancellation races with completion, the confirmed gateway outcome wins.

Before streaming starts, return `{ error: { code, message, requestId } }` with an appropriate status.
Use 400 for invalid input, 404 for unknown resources, 409 for conflicts, 413 for an excessive body, and 503 when the gateway is unavailable.
After streaming starts, send a safe `failed` event.
Do not rely on the global HTTP error handler to replace an open stream.

## Boundaries and resource limits

Publish the backend only on host loopback. Use one browser origin through the later frontend proxy.
During development, permit only the exact configured frontend origin.
Check Host and Origin for browser requests that change state.
Require JSON for those requests and reject unknown input fields.
Do not treat CORS alone as authorization.

Limit a request body to 16 KiB and message text to 8 KiB of UTF-8.
Limit a visible answer to 64 KiB.
If that limit is exceeded, stop buffering, report the limit, and request cancellation.
Keep the run slot reserved until the gateway confirms the outcome.
Bound stream buffers and history projections.
When a client cannot keep up, close its stream and direct it to history.
Keep run observation independent of that stream.

Mount the provider key only in the gateway.
Give the backend its own persistent device identity and scoped token.
Supply a bootstrap gateway credential through a secret file for initial pairing.
Prefer the saved device token on later connections.
Review and approve only the exact pending device request.
Keep pairing in the setup instructions; do not add another pairing service.

Request only the gateway scopes required for chat and history.
Advertise only implemented client capabilities. Do not approve tool execution automatically.
Do not expose raw RPC, configuration changes, or arbitrary gateway URLs.
Keep the gateway state volume private to the gateway.
Keep credentials and message bodies out of application logs.
Log safe request IDs, run IDs, durations, and error categories.

Use one backend process. Close streams and the gateway connection on shutdown.
Preserve state volumes and the 2 GB WSL cap. Set a backend container memory limit in Compose.

## Source organization and dependencies

Keep these responsibilities in `apps/api/src`:

| File | Responsibility |
| --- | --- |
| index.ts and app.ts | Server lifecycle and application wiring |
| routes.ts | Register paths, middleware, and controller handlers |
| controller.ts | Read validated input and select JSON or SSE responses |
| middleware.ts | Host, Origin, body, message, parameter, and page validation |
| stream.ts | Bound SSE writes and manage the HTTP writer lifetime |
| chat.ts | Coordinate gateway access, submissions, and recovery |
| chat/conversations.ts | Empty conversations, list pages, and history projection |
| chat/runs.ts | Idempotency, run state, event ordering, and output limits |
| chat/recovery.ts | Restore subscriptions and reconcile authoritative gateway state |
| openclaw.ts | Own the official connection and translate RPC calls |
| gateway/device.ts | Private identity, signatures, and scoped-token storage |
| gateway/messages.ts | Session keys, gateway payload checks, and visible messages |
| types.ts | Backend type declarations and HTTP context contracts |
| errors.ts, pagination.ts, and validation.ts | Shared error responses, cursors, and input primitives |

Keep backend type declarations in types.ts. Add shared contracts only when React needs them.
Put a blank line between library imports and local imports.
Separate logical code chunks and methods with a blank line.
Keep resource and run-state checks in their services. HTTP middleware must not own the run lock.
Avoid generic repositories, plugin systems, and dependency-injection frameworks.

Use npm workspaces, a committed lockfile, and Hono's Node adapter and streaming helper.
Pin exact compatible official gateway client and protocol packages.
Verify the published packages against the existing 2026.10.3 gateway before installing.
The generic client guide shows an older package example; it does not establish the correct project pin.

Use Oxlint and Oxfmt. Use Vitest if automated integration checks are requested.
Do not restore the removed harness. Ask before adding other direct tooling.

## Acceptance

| Scenario | Required outcome |
| --- | --- |
| Fresh setup | Backend pairs through the documented procedure and becomes ready from its own container |
| Text and streaming | A live request produces visible updates before a completed answer |
| Context and isolation | A second turn retains a harmless marker; another conversation does not receive its events |
| Duplicate and busy requests | Repeated IDs and concurrent sends do not create another gateway submission |
| Invalid input | Rejected input creates no model run |
| Browser loss | The run remains observable through history without a second submission |
| Gateway loss or restart | Readiness fails, recovery restores known state, and no message is resubmitted |
| Cancellation | The exact run is targeted and its confirmed final state is reported |
| State and credentials | Saved history survives restart; browser responses contain no credentials |

Use a short manual integration walkthrough for this stage.
Keep live model checks opt-in and limit them to three short messages for basic response, context, and isolation.
Use a separate longer response only when the short messages cannot show streaming.
Check transport failures without repeated paid retries.
Record meaningful outcomes rather than shallow function checks.

The [recorded tool-call failure](findings.md#f02-tool-call-name-changed-during-a-responses-stream) remains unresolved.
Report it through the same error path.
Do not claim that this backend repairs gateway or provider tool execution.

## Future accounts

Keep one explicit local owner and one instance resolver at the chat-service boundary.
Do not add login or tenant infrastructure now.
Future accounts require authenticated ownership, protected per-instance credentials, separate device identities, authorized connection selection, and isolated event routing.
See [architecture](architecture.md#future-accounts-and-separate-gateways).

## References

- [Assessment requirements](requirements.md)
- [Current architecture](architecture.md)
- [Gateway findings](findings.md)
- [Hono streaming and stream errors](https://hono.dev/docs/helpers/streaming)
- [Official client lifecycle and recovery](https://docs.openclaw.ai/gateway/clients)
- [Pinned client package](https://github.com/openclaw/openclaw/blob/v2026.10.3/packages/gateway-client/package.json)
- [Pinned send, history, cancellation, and event schemas](https://github.com/openclaw/openclaw/blob/v2026.10.3/packages/gateway-protocol/src/schema/logs-chat.ts)
