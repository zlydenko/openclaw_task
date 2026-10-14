# OpenClaw in Docker

R1 runs one OpenClaw gateway container with OpenRouter and `moonshotai/kimi-k2-thinking`.
Use OpenClaw's built-in terminal client to talk to the agent.
Hono and React follow in later stages.

## Start

Install Docker Desktop with Linux containers and Node.js 22.19 or newer.
Use Bash for the commands below.

1. Put the separately supplied API key in `openrouter_key` at the repository root.
2. Prepare local files:

```bash
node scripts/setup.mjs
```

3. Build and start the gateway:

```bash
docker compose up -d --build --wait --wait-timeout 90
```

4. Open the official terminal client:

```bash
docker compose exec openclaw-gateway node dist/index.js tui
```

In Git Bash, prefix that last command with `winpty` if Docker reports that the input is not a TTY.
Use the terminal client's session picker to select a saved conversation.
Press Ctrl+C twice to leave the terminal client.

Stop the gateway when finished:

```bash
docker compose stop
```

## Credentials and state

The real `openrouter_key` is local and ignored by Git and Docker builds.
Send it privately to reviewers alongside the repository.
Reviewers can also supply their own OpenRouter key.
The example file contains no credential.

Setup generates `.local/gateway_token` and a public CA bundle.
It preserves an existing gateway token.
The CA bundle supports HTTPS through the host's trusted certificate store.

Compose mounts credentials as secret files.
The entrypoint copies them into private temporary storage with mode 0600.
The gateway port is not published on the host.
Conversation history and configuration persist in the `gateway_state` volume.
Do not use `docker compose down --volumes` to stop the application.

The configuration template is used only for new state.
Existing configuration is preserved.
The user-requested WSL memory cap remains 2 GB.

## Files

| File                           | Purpose                                                              |
| ------------------------------ | -------------------------------------------------------------------- |
| `compose.yaml`                 | One gateway service, credentials, health check, and persistent state |
| `docker/Dockerfile`            | Pinned official image and the startup script                         |
| `docker/openclaw.json`         | Provider, model, authentication, and agent settings                  |
| `docker/gateway-entrypoint.sh` | Prepare private secrets and seed initial configuration               |
| `scripts/setup.mjs`            | Prepare local credentials and public certificate trust               |

The model uses the Responses API for visible streaming.
Tool definitions are supplied directly under the full tool profile.
Existing execution and service permissions still apply.
Provider tool-call compatibility remains an unresolved finding.

Read [requirements](docs/requirements.md) for the assessment scope and agreed tools.
Read [architecture](docs/architecture.md) for the current setup and future application design.
Use [gateway operation](docs/gateway-operation.md) for restart and configuration notes.
Use [verification](docs/verification.md) for manual checks and application acceptance criteria.
Read [findings](docs/findings.md) for historical integration results and limitations.
