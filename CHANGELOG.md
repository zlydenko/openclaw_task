# Changelog

Release, finding, and decision dates follow the project commit timeline.
Test, log, and pricing dates remain as recorded.

## Image attachments — 2026-10-15

- Add an image picker, clipboard paste, thumbnails, and removal in the composer.
- Send image-only messages or images with text through official OpenClaw chat.send attachments.
- Limit images to four files and 5 MiB in total. Validate input before run admission.
- Include attachments in request identity. Keep drafts and recovery isolated by conversation.
- Show saved image filenames without returning image bytes in history responses.
- Configure Gemini 2.5 Flash-Lite through OpenRouter for the native image tool. Keep Kimi for chat.
- Add HTTP/SSE attachment checks. Make no paid image-analysis requests.

## Initial concurrency configuration — 2026-10-15

- Keep the three-run gateway limit in the initial OpenClaw configuration.
- Remove the startup override script. Preserve saved configuration on later starts.

## Conversation naming decision — 2026-10-15

- Keep first-message excerpts as conversation titles for this stage.
- Document model-based summaries as optional and explain that they can reuse the existing provider.

## Reliable conversation title fallback — 2026-10-15

- Show short user-text titles for existing unnamed conversations.
- Use the same fallback when native naming returns a random crustacean name.
- Keep custom names and useful generated titles first.
- Bound and cache history reads. Do not make paid backfill requests or replay messages.
- Verify names for all 12 saved conversations before and after an API restart.

## Message queue design notes — 2026-10-15

- Shorten the parallel conversation report. Compare an in-process queue, Redis Streams, and more execution capacity.
- Separate proposed message admission from the current three-run limit.

## Automatic conversation titles — 2026-10-15

- Use OpenClaw native first-message naming for new application conversations.
- Read saved display names and preserve custom-name priority.
- Refresh sidebar titles without another message submission or loss of loaded pages.
- Preserve legacy conversation keys, history, subscriptions, and cancellation.
- Record the official naming flow and verification limits in findings.

## Parallel conversation documentation — 2026-10-15

- Explain the three-run architecture, admission checks, event routing, and recovery in the README.
- Document shared resources, configuration updates, and the limits of the concurrency checks.

## Parallel conversations — 2026-10-15

- Permit three concurrent conversations, with one active turn per conversation.
- Keep streaming, cancellation, tool events, and recovery separate for each run.
- Apply the gateway concurrency limit to new and saved configuration.
- Reject extra sends before gateway submission. Keep pending and unresolved runs reserved.

## Tool activity — 2026-10-15

- Show live and saved tool activity with expandable safe summaries and explicit outcomes.
- Use official tool events and native OpenClaw recovery.
- Keep failed calls visible after later success.
- Check HTTP/SSE delivery, history restoration, and conversation isolation.

## Tool activity findings — 2026-10-15

- Record the rejected apply_patch format and the separate streamed tool-name failure.
- Explain the tool-content display warning and propose live activity rows with saved outcomes.
- Keep the proposed display changes unimplemented.

## Frontend usability — 2026-10-15

- Show a green connected-status dot in both themes and consistent cursors for interactive controls.
- Add the short CSR versus SSR rationale to the README.

## React frontend — 2026-10-15

- Add a React, TypeScript, Vite, and plain CSS conversation interface.
- Add monochrome dark/light themes, responsive navigation, and animated waiting text.
- Read real SSE snapshots and retain run state across conversation navigation.
- Add cancellation and history recovery without automatic paid message retries.
- Serve the production frontend through Hono in the existing Docker container.
- Add controlled HTTP/SSE integration checks with Vitest.

## Frontend design — 2026-10-15

- Define a React, TypeScript, Vite, and plain CSS frontend PRD.
- Specify monochrome themes, conversations, streaming, cancellation, recovery, and animated waiting text.
- Keep frontend implementation deferred.

## Backend cleanup — 2026-10-14

- Extract type contracts, controllers, reusable request middleware, and SSE handling.
- Split chat coordination into conversation, run-tracking, and recovery modules.
- Extract gateway device storage and visible-message projection.
- Separate library imports, local imports, methods, and logical code chunks with blank lines.
- Retain the current single-run policy and existing gateway permissions.

## Hono backend — 2026-10-14

- Add conversation, history, SSE, cancellation, and health routes.
- Use the official 2026.10.3 gateway client with a private device identity.
- Track one active run and block duplicate or uncertain submissions.
- Add a backend container with a loopback HTTP port and a 256 MiB memory limit.
- Document first-time pairing and manual backend checks.
- Record the single-run limit and future queued or steering input in findings.
- Use built-in CA certificates by default. Make custom CA support an explicit Compose override.
- Keep React deferred.

## R2 design — 2026-10-14

- Define the proposed Hono API, streaming, recovery, limits, and acceptance criteria.
- Keep backend and frontend implementation deferred.

## R1 — 2026-10-14

- Set up one digest-pinned OpenClaw gateway in Docker.
- Configure OpenRouter with moonshotai/kimi-k2-thinking through the Responses API.
- Use the official OpenClaw terminal client for manual chat.
- Supply credentials through local ignored files and Compose secrets.
- Preserve gateway state and keep the gateway port private.
- Document requirements, architecture, operation, verification, and integration findings.
