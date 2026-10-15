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
The backend and React interface are implemented.

1. Run `npm run check` and `npm run build`.
2. Run `docker compose config --quiet` and start the services.
3. Before approval, check that `/health` returns 200 and `/ready` returns 503.
4. Review and approve the exact backend device. Restart only the API. Check `/ready`.
5. Create a conversation. Check its list and empty history.
6. Send invalid JSON, extra fields, an invalid request ID, and excessive text. Expect 400 or 413.
7. Send from another Origin or Host. Expect rejection.
8. With a paid-check budget, send one short message. Observe accepted, message snapshots, and a terminal event.
9. While it runs, repeat its request ID and submit another message in the same conversation. Expect 409.
   Start runs in two other conversations. A fourth concurrent conversation must return 409 without a gateway submission.
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

## Backend cleanup verification — 2026-10-15

- TypeScript build, Oxlint, and Oxfmt passed after the module split.
- The same one-off HTTP/chat exercise passed before and after refactoring. It checked validation, visible snapshots, event isolation and ordering, duplicate and busy requests, browser loss, exact cancellation, reconnect recovery, lost acknowledgements, and events received before acknowledgement. Its gateway was an in-memory substitute. No test harness was added to the repository.
- The rebuilt API container reused its saved device identity and token. Authenticated readiness, both existing histories, conversation pagination, and invalid-request rejection passed against the real gateway.
- No paid model calls were made for this refactor. Earlier provider results remain historical evidence.

## Full application acceptance

Use these criteria for the full application. The frontend verification record below describes completed checks.

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

Use npm test for the frontend integration checks.
Prefer outcome evaluations over exact comparisons of generated prose.
Avoid shallow unit tests and arbitrary coverage targets.
Keep any evaluation set small and bound its paid request count.

## Frontend verification — 2026-10-16

- React/React DOM 19.3.1, Vite 8.3.4, and Vitest 5.0.5 were checked against the npm registry and pinned.
- TypeScript, Oxlint, Oxfmt, and the production build passed. Ten Vitest integration checks passed with controlled HTTP/SSE responses. They cover fragmented Unicode streams, snapshot replacement, navigation isolation, cancellation races, interrupted observation, unknown submissions, adoption of existing runs, stale reads, opaque pagination, and Hono static-serving boundaries. They make no provider calls and do not emulate gateway RPC.
- The production image built and started through Compose. Hono served the HTML, JavaScript, CSS, and theme bootstrap on port 3000. Health and authenticated readiness returned 200. Unknown API routes and local credential paths returned JSON 404 responses.
- The browser checks covered new conversations, saved histories, Enter/Shift+Enter, blank and excessive input, light/dark themes, saved theme choice, and missing-conversation recovery. Desktop layout passed at 1024 × 768. The mobile sidebar passed at 390 × 844 with no horizontal overflow. Opening it moved focus inside; Escape closed it and returned focus. The reduced-motion CSS fallback was inspected. An operating-system motion preference was not emulated.
- Five paid test requests were used under the user's limit of 20. The first showed real visible text before completion. The second recalled a harmless marker after navigating away and back. A new conversation returned NONE for the marker. A fourth run showed Stopping before a confirmed cancellation. Refreshing during the fifth run recovered its active state and later its history without another message submission. The browser correctly retained an unknown final outcome because it did not observe that run's terminal event.
- A separate busy attempt returned 409 before admission and retained its draft. It did not start another model run.
- A trailing newline in keyboard input exposed a duplicate optimistic row when gateway history trimmed that whitespace. Reconciliation now matches normalized outer whitespace while excluding prior message IDs. The integration check includes this case.
- The fifth answer also addressed the cancelled prompt retained in conversation history. It did not follow the requested five-sentence limit. This exercise verifies recovery, not exact prose compliance or tool-call compatibility.
- Vite on port 5173 loaded history and created an empty conversation through its proxy with the exact DEV_ORIGIN enabled. The temporary server was stopped and that origin was disabled afterward. The production origin remained available.
- Served browser assets were compared with the local provider key and gateway token. Neither credential was present. Production responses included a same-origin content policy.
- Existing gateway conversations, backend device state, volumes, and memory limits were preserved. These checks reused the approved device; they did not repeat first-time pairing in a fresh environment. Local Docker checks used the documented optional CA override required by this network.

## Tool activity verification — 2026-10-16

- Thirteen controlled HTTP/SSE checks and the production build passed. They cover activity delivery through Hono and React, navigation isolation, safe summaries, history pages with separate calls and results, and outcomes received before send acknowledgement. These checks do not prove model behavior.
- A browser read of the saved F05 conversation showed read as Completed and apply_patch as Failed. Expanding the failed action showed the patch-format explanation. Generic unsupported-content notices and empty reasoning rows were absent.
- Two live model messages used the approved budget. The first executed read successfully, and the UI displayed its completed outcome. The model then stopped after announcing a patch without executing it.
- The second requested a malformed patch. The model requested a nonexistent tool with a call_functions_apply_patch prefix. The saved result reported failure, and the UI displayed it. The model ended with a promise to correct it. The actual apply_patch tool did not execute, and the fixture remained unchanged.
- Real patch correction with the selected provider route remains unverified. Tool-name and settled-turn behavior remain integration limitations.
- Compose validation, Bash entrypoint syntax, gateway configuration validation, gateway health, and authenticated backend readiness passed. State volumes and device identities were retained.
- No further paid requests were sent. The browser and backend did not repeat message POST requests.

## Parallel conversations — 2026-10-16

- TypeScript, Oxlint, Oxfmt, all 17 controlled HTTP/SSE integration checks, and the production build passed.
- The checks cover three simultaneous conversations, rejection of a fourth send, same-conversation and duplicate rejection, event isolation, exact cancellation, and slot reuse after completion.
- Recovery checks cover multiple adopted runs, gateway loss, an interrupted stream while another stream remains open, and an unknown acknowledgement that retains its slot.
- Default and custom-CA Compose validation passed. Both rebuilt containers are healthy. Gateway configuration validation passed, and the saved concurrency setting is 3.
- HTTP health, authenticated readiness, the frontend, and the conversation list returned 200. Saved gateway and device volumes were retained.
- No paid model calls were made. The simultaneous provider requests were checked only with controlled responses.

## Evidence

Record the date, command, software version, expected result, and actual result.
Separate manual observations from automated checks.
Keep unresolved errors visible.
Do not include credentials, private keys, authentication frames, or private conversation transcripts.


## Conversation titles — 2026-10-16

- Inspected the pinned 2026.10.3 gateway distribution and official protocol schemas. Automatic naming requires an eligible interactive key and saves displayName. Roster reads do not request generation.
- TypeScript, Oxlint, Oxfmt, all 21 integration checks, and the production build passed.
- Controlled checks cover dashboard keys, unnamed empty conversations, stored display names, custom-name precedence, legacy history/send/subscription/cancellation routing, events for both prefixes, and delayed title updates after navigation. Loaded list pages and their cursor remain available during metadata refresh.
- Compose validation, gateway configuration validation, and service health passed. The rebuilt API serves the naming change.
- Running-API checks passed for health, authenticated readiness, saved history, empty conversation creation/listing, invalid request IDs, rejected Origin and Host headers, and missing conversations. No valid message was submitted.
- The API restarted without deleting volumes. It reused its saved identity and token. A saved conversation returned the same history projection after restart. Empty in-memory conversations correctly disappeared.
- Existing findings text was retained. The naming evidence was appended as F07.
- No paid chat or title request was made. Generated wording, timing, provider compatibility, and persistence of a newly generated title require an opt-in live check. Controlled generated-name fixtures do not prove these provider outcomes.

For a future approved live check, start one new conversation with a short topic.
Wait for the title to replace the fallback without a second message POST.
Refresh the browser and restart only the API. Confirm the same title and history.
Count separate title-generation attempts in the paid budget, including the gateway's native fallback attempts.
