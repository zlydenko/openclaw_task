# Gateway operation

Use the [root README](../README.md) for prerequisites, credential setup, build, and terminal chat.
R1 has one gateway service.
The official terminal client runs inside that container.
There is no separate probe or pairing service.

## Check the gateway

Run these commands from the repository root in Bash:

```bash
docker compose config --quiet
docker compose ps
docker compose exec openclaw-gateway node dist/index.js config validate
```

The service must be healthy.
Configuration validation does not confirm provider access or tool-call compatibility.
Use [verification](verification.md) for manual chat checks.

## Stop and restart

```bash
docker compose stop
docker compose up -d --wait --wait-timeout 90
docker compose exec openclaw-gateway node dist/index.js tui
```

In Git Bash, add `winpty` before the last command if Docker reports that the input is not a TTY.
Use the terminal client's session picker to open a saved conversation.
Press Ctrl+C twice to leave the terminal client.
This action leaves the gateway running.

Keep the `gateway_state` volume.
Do not use `docker compose down --volumes` for a routine stop.
Messages remain in private gateway history.
Model requests use paid OpenRouter credit.

## Configuration changes

The entrypoint seeds `docker/openclaw.json` only when no saved configuration exists.
A rebuild does not replace the configuration in an existing volume.
Use the OpenClaw CLI to change saved settings explicitly.
Validate the configuration after each change.
Restart the gateway when the change requires it.

The selected model uses `openai-responses`.
The full tool profile supplies tool definitions directly.
Existing execution permissions and disabled services still apply.
Read [findings](findings.md) before changing the provider API or claiming that tool calls work.

## Tool recovery

Use OpenClaw's native agent loop and provider recovery.
The application does not repeat message submissions.
Tool errors can lead to a corrected call. The model can stop before a correction succeeds.
Check the Activity rows and final answer to confirm the outcome.
Configuration validation does not prove that a model will produce a valid tool call.

## Local setup files

Keep `openrouter_key` local and ignored by Git.
Supply it privately to reviewers or let them use their own key.
Compose supplies the provider key and gateway token as secret files.

Run `node scripts/setup.mjs` to prepare credentials.
The script preserves an existing gateway token.
Node uses its built-in CA certificates by default.
For a network that requires custom trust, use the [optional CA override](../README.md#optional-custom-ca-certificates).
After replacing a custom bundle, rebuild the API without cache and recreate the containers with that override.
Do not disable TLS certificate validation to fix a certificate error.

Keep the user-requested 2 GB WSL memory cap.
Build containers sequentially.
