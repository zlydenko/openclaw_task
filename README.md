# OpenClaw chat

R1 runs one OpenClaw gateway container with OpenRouter and `moonshotai/kimi-k2-thinking`.
Use OpenClaw's built-in terminal client to talk to the agent.
The Hono backend and React interface run in a second container.
The frontend uses TypeScript, Vite, and plain CSS.

## Start

Install Docker Desktop with Linux containers and Node.js 22.19 or newer.
Use Bash for the commands below.

1. Put the separately supplied API key in `openrouter_key` at the repository root.
2. Prepare local files:

```bash
node scripts/setup.mjs
```

3. Build and start both services:

```bash
docker compose up -d --build --wait --wait-timeout 90
```

4. Pair the backend on its first start:

```bash
docker compose logs api
docker compose exec openclaw-gateway node dist/index.js devices list
```

Find the pending device named `Assessment Hono backend`.
Compare its device ID with the backend log.
Check that it requests only `operator.read` and `operator.write`.
Approve that exact request. Do not approve another device or use `--latest`.

```bash
PAIRING_REQUEST_ID='paste-the-reviewed-request-id'
docker compose exec openclaw-gateway node dist/index.js devices approve "$PAIRING_REQUEST_ID"
docker compose restart api
curl http://localhost:3000/ready
```

The result must be `{"status":"ready"}`.
`/health` checks the HTTP process only. It can pass before pairing.
Later starts reuse the saved device token.

5. Open [the chat interface](http://localhost:3000).
Create a conversation or select one from the sidebar.
Use the appearance switch to select the light theme.

6. Open the optional official terminal client:

```bash
docker compose exec openclaw-gateway node dist/index.js tui
```

In Git Bash, prefix that last command with `winpty` if Docker reports that the input is not a TTY.
Use the terminal client's session picker to select a saved conversation.
Press Ctrl+C twice to leave the terminal client.

Stop the services when finished:

```bash
docker compose stop
```

## Credentials and state

The real `openrouter_key` is local and ignored by Git and Docker builds.
Send it privately to reviewers alongside the repository.
Reviewers can also supply their own OpenRouter key.
The example file contains no credential.

Setup generates `.local/gateway_token`. It preserves an existing token.
Builds and containers use Node's built-in CA certificates by default.
No host certificate file is required.

Compose mounts credentials as secret files.
The gateway entrypoint copies its credentials into private temporary storage with mode 0600.
The gateway port is not published on the host.
Conversation history and configuration persist in the `gateway_state` volume.
The backend stores its own identity and scoped device token in `api_state`.
The provider key is mounted only in the gateway.
The backend receives the bootstrap gateway token as a secret file.
Its HTTP port is published only on `127.0.0.1:3000`.
Plain gateway WebSocket traffic stays inside the trusted local Compose network.
Do not use `docker compose down --volumes` to stop the application.

The configuration template is used only for new state.
Existing configuration is preserved.
The user-requested WSL memory cap remains 2 GB.

## Use the backend

Create a conversation. Copy its returned ID.

```bash
curl --json '{}' http://localhost:3000/api/conversations
CONVERSATION_ID='paste-the-returned-id'
REQUEST_ID=$(node -p "crypto.randomUUID()")
curl -N --json "{\"requestId\":\"$REQUEST_ID\",\"text\":\"Reply with a short greeting. Do not use tools.\"}" \
  "http://localhost:3000/api/conversations/$CONVERSATION_ID/messages"
```

Each valid message uses paid model credit.
Use a fresh request ID for each intended message. Never retry a POST automatically.
The stream emits `accepted`, visible `message` snapshots, and one terminal event.
Replace displayed text with each snapshot. Do not append it.
A closed stream without a terminal event has an unknown outcome.
Read history before sending another message.

```bash
curl http://localhost:3000/api/conversations
curl "http://localhost:3000/api/conversations/$CONVERSATION_ID"
curl --json '{}' \
  "http://localhost:3000/api/conversations/$CONVERSATION_ID/runs/<runId>/cancel"
```

Cancellation acceptance does not prove the run stopped.
Read the terminal event or history to check its outcome.
Only application conversations appear in this API.
Empty conversations exist in memory until their first accepted message.
The backend permits one active application run and returns 409 for extra sends.
An unresolved submission blocks later sends. Restarting is not a safe retry procedure.

Use `localhost` in these examples. Host and Origin checks reject other origins by default.
Set `APP_ORIGIN` for the intended application origin.
Set `DEV_ORIGIN` to one exact origin when using the Vite development server.
Do not expose this trusted single-user service publicly.

## Local code checks

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run build
```

Use Node.js 22.19 or newer. The Docker image pins Node.js 22.23.3.
`npm run check` checks TypeScript, Oxlint, and Oxfmt.
`npm test` runs frontend HTTP/SSE integration checks and Hono static-serving checks with controlled responses.
These checks do not use paid model credit.
Credentials and local certificate files do not enter the Docker build context.

## Frontend development

Use the Docker backend with the Vite development server.
Set the exact development origin when starting the API container:

```bash
DEV_ORIGIN=http://localhost:5173 docker compose up -d api
npm run dev
```

Open `http://localhost:5173`. Vite forwards `/api` and `/ready` to Hono.
If your network needs custom CA certificates, use the two Compose files from the next section with the same `DEV_ORIGIN` prefix.
Do not change the proxy Host or remove the backend Origin checks.
The production build runs through Hono on port 3000. It does not need a Vite server.

The interface keeps one known active run across conversation navigation.
Send is paused while that run is active or unresolved. You can still edit drafts.
Stop requests cancellation. Wait for the confirmed outcome.
A lost stream recovers through history reads. The interface does not repeat message requests.
Only the theme is saved in browser storage. Drafts are lost on page refresh.

## Optional custom CA certificates

Use this only if your network requires a custom CA, such as an HTTPS inspection proxy.
Obtain a public PEM certificate bundle from your network administrator.
Save it in the ignored file `.local/custom-ca.pem`. Do not include private keys.
The setup script does not export host certificates.

```bash
export CUSTOM_CA_FILE=./.local/custom-ca.pem
docker compose -f compose.yaml -f compose.ca.yaml build --no-cache api
docker compose -f compose.yaml -f compose.ca.yaml up -d --build --wait --wait-timeout 90
```

Use both `-f` arguments for later Compose commands in this environment.
The override mounts the bundle at runtime and passes it as a temporary build secret for npm.
It does not copy certificates into image layers.
Use `--no-cache api` again after replacing the bundle because build-secret content does not invalidate cached build steps.
Keep TLS certificate verification enabled.
See [Docker build secrets](https://docs.docker.com/build/building/secrets/).

For npm commands on the host, set `NODE_EXTRA_CA_CERTS` to the absolute path of your PEM bundle.
Do this only in the terminal where you need the extra trust.

## Files

| File                           | Purpose                                                              |
| ------------------------------ | -------------------------------------------------------------------- |
| `compose.yaml`                 | Gateway and backend services, secrets, limits, and private state |
| `docker/Dockerfile`            | Pinned official gateway image and startup script |
| `docker/api.Dockerfile` | Pinned Node image and the backend build |
| `apps/api/src` | Controllers, middleware, chat components, types, and the gateway adapter |
| `apps/web/src` | Chat interface, HTTP/SSE client, run recovery, themes, and integration checks |
| `docker/openclaw.json`         | Provider, model, authentication, and agent settings                  |
| `docker/gateway-entrypoint.sh` | Prepare private secrets and seed initial configuration               |
| `scripts/setup.mjs`            | Prepare local credentials |
| `compose.ca.yaml` | Optional custom CA mounts for build and runtime |

The model uses the Responses API for visible streaming.
Tool definitions are supplied directly under the full tool profile.
Existing execution and service permissions still apply.
Provider tool-call compatibility remains an unresolved finding.

Read [requirements](docs/requirements.md) for the assessment scope and agreed tools.
Read [architecture](docs/architecture.md) for the current setup and future application design.
Read the [Hono backend PRD](docs/backend-prd.md) for the backend API and behavior.
Read the [React frontend PRD](docs/frontend-prd.md) for the interface requirements and acceptance checks.
Use [gateway operation](docs/gateway-operation.md) for restart and configuration notes.
Use [verification](docs/verification.md) for manual checks and application acceptance criteria.
Read [findings](docs/findings.md) for historical integration results and limitations.
