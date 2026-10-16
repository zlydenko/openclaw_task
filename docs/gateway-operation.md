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
The full tool profile uses tool search. Code mode uses automatic model selection with the bundled QuickJS executor.
Memory uses local keyword search. Private cross-conversation recall is enabled and can add a model request during a user turn.
Browser support and the built-in Control UI are enabled. The gateway port remains private.
The official browser image supplies Chromium at `/usr/local/bin/chromium`.
The [sandbox syscall policy](../docker/README.md) permits Chromium sandbox startup while the container keeps all capabilities dropped.
The scheduler is enabled. Its system-owned background schedules were reconciled before activation; no enabled jobs remain locally.
Memory dreaming and periodic heartbeats remain disabled. Skill Workshop proposes changes for review.
Existing execution permissions remain in force. Elevated execution stays disabled.
Read [findings](findings.md) before changing the provider API or claiming that tool calls work.

## Gateway browser

The image keeps Chromium outside the writable cache mount.
New configurations select /usr/local/bin/chromium. For an existing saved configuration, set this path explicitly:

```bash
docker compose exec openclaw-gateway node dist/index.js config set browser.executablePath /usr/local/bin/chromium
docker compose exec openclaw-gateway node dist/index.js config validate
```

Use the official CLI to check the browser without a model request:

```bash
docker compose exec openclaw-gateway node dist/index.js browser start
docker compose exec openclaw-gateway node dist/index.js browser open about:blank
docker compose exec openclaw-gateway node dist/index.js browser navigate https://1.1.1.1/cdn-cgi/trace
docker compose exec openclaw-gateway node dist/index.js browser snapshot
docker compose exec openclaw-gateway node dist/index.js browser stop
```

Keep browser sandboxing enabled. Browser ports remain internal.
The pinned release requires a blank tab followed by navigate for strict redirect inspection.
Strict policy accepts public IP URLs. Domain URLs require exact trusted names in browser.ssrfPolicy.allowedHostnames.
Keep browser.ssrfPolicy.dangerouslyAllowPrivateNetwork false.

The isolated public-only proxy alternative was investigated and skipped at the user's request.
See the [README trade-offs](../README.md#browser-networking-trade-offs) and [finding F11](findings.md#f11-strict-browser-networking-limits-normal-public-website-access).

In the local check, browser stop left Chromium child processes and did not complete.
A gateway restart cleared them. If this occurs, first confirm that no chat run is active, then restart the gateway without deleting volumes.

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
