# Architecture decisions

## Current R1

One Docker service runs the OpenClaw gateway.
The official terminal client runs inside the gateway container.
The gateway calls OpenRouter through HTTPS with `moonshotai/kimi-k2-thinking`.
Hono, React, a separate client container, and application packages remain deferred.

Compose supplies file secrets and a persistent `gateway_state` volume.
The gateway port is not published on the host.
The image is pinned in `docker/Dockerfile`.
The [README](../README.md) describes the implemented setup.

The provider API is `openai-responses`.
Historical checks found visible streaming with the selected model.
Tool-call compatibility remains unresolved.
Read [findings](findings.md) for the evidence and limits.
The full tool profile and direct definitions do not override existing service permissions.

## Planned application

The [Hono backend PRD](backend-prd.md) defines the proposed R2 HTTP contract and failure behavior.

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
Choose frontend serving and routing when the application is implemented.

| Component | Responsibility |
| --- | --- |
| React | Input, messages, partial answers, connection state, and useful errors |
| Hono routes | Validate requests and provide the HTTP interface |
| Chat service | Coordinate conversations, active runs, and event delivery |
| Gateway adapter | Use the official client and translate supported gateway events |
| OpenClaw | Run the agent, retain conversation state, and call the provider |

Keep credentials in the backend and gateway.
Expose only the application commands that the browser needs.
Keep session and run identifiers on applicable events.

## Gateway client and transport

Use the official OpenClaw client behind a small adapter.
Read the pinned package interfaces before backend implementation.
Verify compatibility with the pinned gateway.
R1 does not include a separate client package.

Use HTTP requests for message submission and SSE for response events.
Keep the gateway WebSocket connection inside the backend.
Subscribe before a run can emit events.
Correlate events with both the session and run.
Do not resend an accepted message because a browser stream closes.
Use explicit gateway cancellation when cancellation is implemented.

## State

Use OpenClaw conversation history for the single-user application.
Do not add an application database for this scope.
Persist gateway configuration and conversations in the gateway volume.
When a separate backend client is added, store its device identity and token privately.
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
