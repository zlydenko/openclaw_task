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

## Full application acceptance

Hono and React remain deferred.
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

Use Vitest for meaningful integration checks when application code exists.
Prefer outcome evaluations over exact comparisons of generated prose.
Avoid shallow unit tests and arbitrary coverage targets.
Keep any evaluation set small and bound its paid request count.

## Evidence

Record the date, command, software version, expected result, and actual result.
Separate manual observations from automated checks.
Keep unresolved errors visible.
Do not include credentials, private keys, authentication frames, or private conversation transcripts.
