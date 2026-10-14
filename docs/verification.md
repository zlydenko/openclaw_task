# Verification

## R1 manual checks

R1 uses the official terminal client.
It has no custom probe or automated integration harness.
These checks describe expected behavior. They are not a record of completed runs.
Read [findings](findings.md) for historical results and unresolved limitations.

1. Follow the [README](../README.md) from a fresh checkout with privately supplied credentials.
2. Run `docker compose config --quiet`. It must accept the Compose configuration.
3. Start the gateway. Check that `docker compose ps` reports a healthy service.
4. Run `docker compose exec openclaw-gateway node dist/index.js config validate`.
5. Open the terminal client. Check that it connects to the gateway.
6. Send a short message. Check that the selected model returns a completed answer.
7. Ask for eight sentences. Check whether visible text arrives before completion.
8. Give the agent a harmless project name. Ask for that name in the same session.
9. Restart the gateway without deleting volumes. Open the saved conversation.

Each submitted message uses paid model credit.
A healthy container or connected client does not prove that model requests succeed.
A text answer does not prove that tool calls work.
Check tool behavior separately with a harmless available tool when needed.
Record a failure before retrying it.

## Backend manual checks

Use the pairing and API commands in the [README](../README.md).
The backend is implemented. React remains deferred.

1. Run `npm run check` and `npm run build`.
2. Run `docker compose config --quiet` and start the services.
3. Before approval, check that `/health` returns 200 and `/ready` returns 503.
4. Review and approve the exact backend device. Restart only the API. Check `/ready`.
5. Create a conversation. Check its list and empty history.
6. Send invalid JSON, extra fields, an invalid request ID, and excessive text. Expect 400 or 413.
7. Send from another Origin or Host. Expect rejection.
8. With a paid-check budget, send one short message. Observe accepted, message snapshots, and a terminal event.
9. While it runs, repeat its request ID and submit another message. Expect 409 and no second run.
10. Send a second turn that recalls a harmless marker. Use another conversation for the isolation check.
11. For a separate approved live run, close the browser stream. Read history and activeRun. Do not repeat the POST.
12. Cancel the exact active run. Check its confirmed terminal state.
13. Restart the API without deleting volumes. Check readiness and saved history.
14. Stop and start the gateway. Check readiness failure and recovery. Do not resubmit an unknown message.

Keep live model calls opt-in. The normal check budget is three short messages.
A cancellation or active-run restart exercise can need another paid call; obtain approval first.
The backend may show an unknown outcome after lost terminal observation.
It must not silently mark that run successful or repeat its message.
If an acknowledgement was lost and the gateway cannot resolve it, later sends remain blocked.
Do not clear state to force a retry. Inspect gateway state first.

## Backend verification record — 2026-10-15

- Node.js 22.23.3, Hono 4.13.13, and official client/protocol 2026.10.3.
- TypeScript build, Oxlint, and Oxfmt checks passed.
- Compose validation and the backend container liveness check passed.
- Before pairing, readiness returned 503 with PAIRING_REQUIRED.
- The initial backend build context included a public CA bundle. Custom CA handling was later made optional; the default context now excludes all local certificate files.
- Running-container checks rejected invalid Origin, invalid Host, unknown fields, invalid IDs, and excessive bodies or text. No model calls were made.
- A one-off HTTP/chat exercise with an in-memory gateway checked snapshots, event isolation, duplicate and busy requests, browser loss, exact cancellation, gateway loss, lost-acknowledgement blocking, and adoption of existing runs after restart. It did not use the real gateway or provider. No test harness is included in the repository.
- The user approved the exact backend device with operator.read and operator.write. Authenticated readiness passed from its own container.
- Exactly three paid calls completed with the configured Kimi model: initial response, retained marker context, and a separate conversation without that marker.
- The context turn produced four visible updates. First visible text arrived at 3246 ms; completion arrived at 3686 ms. These are local observations, not performance guarantees.
- Live duplicate and concurrent sends returned 409 during an active run. No extra gateway submission occurred.
- Backend restart reused its saved identity and token. Four messages in the context conversation and two in the separate conversation remained available. Conversation and history pagination passed.
- With the gateway stopped, readiness returned 503, liveness remained 200, and a valid send was rejected before submission. Restarting the gateway restored readiness and saved history.
- Real cancellation and connection loss during a paid run were not exercised. Their coordination paths were checked only with the in-memory gateway. Tool-call compatibility remains subject to the existing findings.

## Optional certificate verification — 2026-10-15

- Setup ran with the old host CA file absent. It did not create a certificate file and preserved the gateway token.
- The default Compose configuration does not reference a host CA file.
- A fresh default dependency download could not complete on this network. npm reported an exit-handler error. Separate public HTTPS checks against npm and OpenRouter failed with UNABLE_TO_VERIFY_LEAF_SIGNATURE using built-in trust.
- The explicit CA override completed a build without cache. Its merged configuration retained the gateway token in the API and kept the provider key exclusive to the gateway.
- The production image contains no custom certificate file and no NODE_EXTRA_CA_CERTS setting.
- Default startup passed with the host CA file absent. Both services used built-in trust, and authenticated backend readiness returned 200. This did not establish provider HTTPS access on this network.
- After restoring the explicit CA override, public npm and OpenRouter HTTPS checks returned 200. Gateway configuration validation and backend readiness passed. Local services remain on that override because this network requires it.
- No paid model calls were made for these checks.

## Full application acceptance

React remains deferred.
Verify these behaviors when they are implemented:

| Behavior | Expected result |
| --- | --- |
| Compose startup | Gateway, backend, and frontend start through the documented procedure |
| Backend connection | Hono authenticates from its own container through Compose service DNS |
| Browser chat | Input and message history work |
| Streaming | Partial answer text appears before the terminal outcome |
| Run failure | The interface shows a useful error or interruption state |
| Connection loss | A reconnect does not submit the same message again |
| Invalid input | Hono rejects the request before starting a gateway run |
| Conversation routing | Context and events stay with the correct conversation |
| Credential handling | Provider and gateway credentials do not reach browser code or network responses |
| Fresh setup | The README identifies all prerequisites and any required device approval |

Use Vitest if automated integration checks are requested.
Prefer outcome evaluations over exact comparisons of generated prose.
Avoid shallow unit tests and arbitrary coverage targets.
Keep any evaluation set small and bound its paid request count.

## Evidence

Record the date, command, software version, expected result, and actual result.
Separate manual observations from automated checks.
Keep unresolved errors visible.
Do not include credentials, private keys, authentication frames, or private conversation transcripts.
