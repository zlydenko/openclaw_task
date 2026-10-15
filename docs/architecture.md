# Architecture decisions

## Current services

One Docker service runs the OpenClaw gateway. A second service runs Hono.
The official terminal client runs inside the gateway container.
The gateway calls OpenRouter through HTTPS with `moonshotai/kimi-k2-thinking`.
Hono serves the React production build on the same browser origin.
The backend source is in apps/api/src. The frontend source is in apps/web/src.

Compose supplies file secrets and a persistent `gateway_state` volume.
The gateway port is not published on the host.
The image is pinned in `docker/Dockerfile`.
The [README](../README.md) describes the implemented setup.

The provider API is `openai-responses`.
Historical checks found visible streaming with the selected model.
Tool-call compatibility remains unresolved.
Read [findings](findings.md) for the evidence and limits.
The full tool profile and direct definitions do not override existing service permissions.

## Application

The [Hono backend PRD](backend-prd.md) defines the HTTP contract and failure behavior.
The [React frontend PRD](frontend-prd.md) defines the interface and browser recovery behavior.

```text
React browser
    | HTTP requests and SSE events
    v
Hono backend container
    | Official client and gateway WebSocket RPC
    v
OpenClaw gateway container
    | HTTPS
    v
OpenRouter with moonshotai/kimi-k2-thinking
```

Use React, TypeScript, Vite, and plain CSS.
Use Hono on Node.js.
Prefer one browser origin.
Vite serves frontend development through a proxy to Hono.
Hono serves the production build. Conversation selection uses URL hashes.

| Component | Responsibility |
| --- | --- |
| React | Input, messages, partial answers, connection state, and useful errors |
| Hono routes and controllers | Register endpoints and return JSON or SSE |
| HTTP middleware | Validate origins, parameters, bodies, and pagination |
| Chat service | Coordinate conversation access and message admission |
| Chat components | Own conversations, run state, event delivery, and recovery |
| Gateway adapter | Use the official client and translate supported gateway events |
| OpenClaw | Run the agent, retain conversation state, and call the provider |

Backend type declarations live in `apps/api/src/types.ts`.
Frontend type declarations live in `apps/web/src/types.ts`.
The frontend API module reads JSON and POST response streams.
A chat controller owns conversation state and read-only recovery polling.
A separate run controller retains submission state while the selected view changes.
React subscribes to that state through useSyncExternalStore.
The browser saves only the theme preference. It keeps drafts and partial output in memory.
Agent text is rendered as plain text. Production static responses use a same-origin content policy.
Controllers consume validated Hono context values.
Run admission remains synchronous inside the chat service.
Gateway device storage and message projection have separate modules.

Keep credentials in the backend and gateway.
Expose only the application commands that the browser needs.
Keep session and run identifiers on applicable events.

## Gateway client and transport

Use the official OpenClaw client behind a small adapter.
The client and protocol packages are pinned to 2026.10.3, matching the gateway.
The backend requests only operator.read and operator.write.
It advertises session-scoped events, chat-only assistant text, and tool events.
It does not advertise approval capabilities.
Text and tool activity use separate bounded snapshots on the same HTTP/SSE response.
The backend correlates agent tool events with the acknowledged run.
History projection joins tool calls and results. React merges matching activity across loaded pages.
OpenClaw owns tool correction and provider recovery through its native mechanisms.
The backend and browser observe each tool call. They do not replay tools or message submissions.

Use HTTP requests for message submission and SSE for response events.
Keep the gateway WebSocket connection inside the backend.
Subscribe before a run can emit events.
Correlate events with both the session and run.
Do not resend an accepted message because a browser stream closes.
Cancellation targets the exact session and run through chat.abort.
Up to three application conversations can run at once. Each conversation permits one active turn.
Extra sends return 409. Pending and unresolved submissions retain their slots.
The initial gateway configuration sets `agents.defaults.maxConcurrent: 3`.
Startup preserves saved configuration. Use the OpenClaw CLI to change an existing value.
Each active conversation keeps its own gateway subscription, browser stream, and recovery state.
Lost browser streams do not own the run lifetime.
The backend checks gateway history after reconnect and never resends an unknown submission.

## Image attachments

React reads selected or pasted PNG, JPEG, WebP, and GIF images in memory.
It sends base64 image attachments on the existing message POST. The limit is four images and 5 MiB in total.
Hono validates the bounded payload before reserving a run. Request identity includes image bytes, order, and filenames.
The adapter passes the official chat.send attachments envelope through the existing client.
OpenClaw owns media detection, storage, and text-only-model offload.
Kimi uses the native image tool with OpenRouter Gemini 2.5 Flash-Lite for image analysis.
The image model uses chat completions and the same provider SecretRef. Its definition and native tool use a 4096-token output limit.
Chat stays on Kimi and the Responses API. No new provider, service, database, or mount is added.
History projects image filenames and stable same-origin preview URLs bound to conversation, message, and image index.
On an image GET, Hono checks the conversation and reads the exact message with official chat.message.get.
The adapter fetches the message's retained media://inbound reference through the authenticated OpenClaw assistant-media route.
It uses the current scoped device token in a server-side header. Reads are bounded to 5 MiB; credentials and upstream headers do not reach the browser.
OpenClaw retains all image storage. Composer and current-turn thumbnails use in-memory bytes.
Read-only recovery never resends attachments. Unknown submissions retain their run lock.
See [the pinned official attachment builder](https://github.com/openclaw/openclaw/blob/v2026.10.3/ui/src/pages/chat/attachment-api.ts).

## State

Use OpenClaw conversation history for the single-user application.
Do not add an application database for this scope.
Persist gateway configuration and conversations in the gateway volume.
New application keys use agent:main:dashboard:assessment-api-<uuid> for native first-message naming.
The gateway stores generated names in displayName. Custom labels take precedence.
The adapter retains legacy assessment-api keys discovered through the roster.
The browser refreshes title metadata through read-only list requests.
Missing names and native random fallback names use a short excerpt from the oldest user text.
The backend reads bounded history pages and caches up to 512 fallback titles.
Fallbacks need no model request or persistent metadata update. Saved messages provide their source after restart.
The backend stores its device identity and token in the private api_state volume.
Only the backend HTTP port is published, on host loopback.
The backend has a 256 MiB container limit. The gateway retains its 1280 MiB limit.
The global WSL memory cap remains 2 GB.
Empty conversations and request deduplication records are in memory.
They are not a durable application database.
A new conversation must not erase older conversations.

## Future accounts and separate gateways

Start with one trusted local owner and one configured gateway.
Resolve the gateway at the backend boundary.
Do not make every module read a global gateway URL.

| Concern | Initial application | Future accounts |
| --- | --- | --- |
| Identity | Fixed local owner | Authenticated users and account membership |
| Instance selection | One configured gateway | Authorized account-to-instance lookup |
| Credentials | Local service secrets | Protected storage and rotation for each instance |
| Connections | One managed connection | Bounded connections keyed by account, instance, and device |
| Conversations | Sessions for one owner | Ownership records linked to account and instance |
| Events | Local session and run routing | Authorization for every stream and event |
| Operations | Local Compose | Provisioning, quotas, resource limits, and health checks |
| Storage | Private gateway and client state | Retention, backups, and deletion per account |

Choose whether an instance belongs to one person or a trusted team.
Use separate gateways and credentials across trust boundaries.
A shared gateway does not provide isolation for mutually untrusted tenants.
Consider separate hosts or operating-system identities for those tenants.

Resolve instance identifiers through server-side ownership checks.
Do not accept arbitrary browser-supplied gateway URLs.
Authorize each command, history request, attachment, and event subscription.

## References

- [Gateway client guide](https://docs.openclaw.ai/gateway/clients)
- [Gateway protocol](https://docs.openclaw.ai/gateway/protocol)
- [OpenRouter Responses API](https://openrouter.ai/docs/api/reference/responses/overview)
- [Hono streaming](https://hono.dev/docs/helpers/streaming)
