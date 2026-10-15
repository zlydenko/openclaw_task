# React frontend PRD (Product Requirements Document)

Status: implementation authorized by the user. The frontend source is in apps/web.
Use the existing [Hono API](backend-prd.md) and [assessment requirements](requirements.md).

## Goal and scope

Let one local user create conversations, read history, and talk to the OpenClaw agent.
Show real response text as it arrives. Use React, TypeScript, Vite, and plain CSS in `apps/web`.
Include cancellation, connection status, and light/dark themes.
Defer accounts, instance selection, attachments, search, rename, deletion, Markdown rendering.
Agent tool permissions remain a gateway concern. Include the tool activity behavior below.

## Layout and appearance

- Default to dark monochrome: near-black surfaces, grey borders, and readable light text.
- Provide a labelled light/dark switch. Save the choice locally and apply it before the first paint.
- Use CSS variables for both themes, system fonts for messages, and monospace for status text.
- Show a green connected-status dot in both themes. Use a pointer cursor for enabled clickable controls.
- Put conversations and a New conversation button in a left sidebar.
- Put the selected title, status, messages, and composer in the main area.
- Use a collapsible sidebar on small screens. Keep the composer clear of messages.
- Provide visible keyboard focus, labelled controls, and text status. Do not rely on colour alone.

Render messages as selectable plain text. Preserve line breaks and wrap long text. Never inject agent HTML.
Follow output only when the user is near the bottom. Otherwise show Jump to latest.

## Conversations and composer

Load conversations at startup, with loading, empty, and error states.
Use server titles when present. Otherwise show New conversation and a short ID.
Use opaque cursors and Load more for list and history pages. Merge by ID without duplicate rows.
Display messages in conversation order and show unsupported or truncated content markers.

Create a conversation only after an explicit click. Prevent duplicate clicks while creation is pending.
Select the returned ID and focus the composer. Store selection in the URL hash for refresh and navigation.
Handle missing conversations gracefully. Explain that empty conversations can disappear after a backend restart.

Use multiline input: Enter sends; Shift+Enter adds a line break. Do not send during input method composition.
Reject blank text and text above 8 KiB of UTF-8. Keep drafts after failed submissions.
Generate one UUID request ID per explicit send. Mark outgoing text pending until acceptance.
Reconcile pending messages with history without duplication. Do not submit from a React effect.

## Waiting animation

Use a small Claude Code-inspired status line with a gentle monochrome text shimmer.

| State | Label |
| --- | --- |
| Waiting for acceptance | Sending… |
| Accepted, no visible text yet | Thinking… |
| Visible text is arriving | Responding… |
| Cancellation requested | Stopping… |
| Stream lost or outcome unknown | Checking response status… |
| Backend unavailable | Agent unavailable |

Animate Thinking… and Responding…. Keep recovery warnings static.
Stop animation on a terminal event. Honour reduced-motion settings with static text.
Use a separate polite status announcement. Do not announce each animation frame or text snapshot.
These labels describe waiting. Do not show private reasoning, invented agent actions, or percentage progress.
Show real text immediately. Do not simulate streaming with a typewriter effect.

## API and run behavior

Use relative URLs and browser `fetch`. Follow the backend PRD for bodies, limits, and errors.

| Request | Purpose |
| --- | --- |
| GET /ready | Gateway availability; this does not prove that a run slot is free |
| GET /api/conversations | Conversation pages |
| POST /api/conversations | Create a conversation with an empty JSON object |
| GET /api/conversations/:id | History, `activeRun`, and `syncState` |
| POST /api/conversations/:id/messages | Submit `{ requestId, text }` and read the SSE response |
| POST /api/conversations/:id/runs/:runId/cancel | Request cancellation with an empty JSON object |

Read SSE across arbitrary network chunk boundaries and ignore comment heartbeats.
Match events to their conversation, request, and accepted run.
Replace visible text with each `message.text` snapshot. Use `completed.text` as the final answer.
Keep partial text after cancellation or failure.

Keep run observation above the selected view. Navigation must not cancel a run or mix messages.
Track each conversation with its own run controller and stream. Permit up to three active or unresolved submissions.
Disable Send in a busy conversation and when all three slots are in use. Allow draft editing and navigation.
Recover each interrupted stream independently, including while other conversations are streaming.
Handle 409 conflicts from another tab clearly. The API has no global active-run listing endpoint.
Stop targets the exact gateway run. A 202 means cancellation was requested, not confirmed.
Use the terminal event or history reconciliation to confirm that the run ended. Completion can win a cancellation race.

After refresh or stream loss, recover through history and readiness. Never repeat the message POST automatically.
A closed stream without a terminal event, `SUBMISSION_UNKNOWN`, or `outcomeUnknown: true` means uncertainty.
Keep that state visible until server evidence resolves it. Do not infer success from a timer or page refresh.
History can prove that a run ended without proving its final outcome. Preserve that distinction.
Poll recovery about every three seconds, one request at a time, with slower retries after errors.
Pause background polling in hidden tabs and refresh on return. Ignore stale reads after navigation or newer events.
Show safe errors for 400, 404, 409, 413, and 503 responses. Retain submission details during recovery.

## Tool activity

Show an expandable Activity list within the assistant turn.
Show tool names, safe targets, and explicit outcomes. Do not infer success from the end of an agent run.
Show each actual tool call and its outcome. Keep failed calls visible after a later success.
Use full activity snapshots from SSE. Keep observation independent of the selected conversation.
Restore activity from saved history and merge calls and results across loaded pages.
Hide empty reasoning-only rows. Known tool blocks must not produce an unsupported-content notice.
Render safe summaries as plain text. Do not expose raw arguments, output, or private reasoning.
OpenClaw owns native recovery. The interface only observes its results.

## Implementation boundaries

Use small components for the shell, sidebar, message list, composer, and waiting status.
Keep HTTP/SSE in an API module, coordination in one hook or reducer, and frontend types in `types.ts`.
Use React state and browser APIs. No UI kit, router, state library, or animation package is required.
Use Oxlint and Oxfmt. Separate library imports, local imports, and logical code chunks with blank lines.

Use the Vite development proxy with the backend's exact allowed Host and Origin settings.
For the final Compose start, serve the Vite build through Hono on the existing loopback port.
Preserve SSE without buffering. Unknown API routes must remain API errors.
Keep the gateway private and preserve the 2 GB WSL cap.
Keep provider keys, gateway tokens, and backend runtime packages out of the browser.
Persist only the theme locally. Do not store transcripts or drafts in browser storage.

## Acceptance checks

1. Create two conversations. Confirm separate histories after real streamed responses, navigation, and refresh.
2. Check fragmented SSE, Unicode, heartbeats, and snapshot replacement without duplicate text.
3. Navigate during a run. Confirm correct routing, the three-run limit, the per-conversation Send lock, and cancellation outcome states.
4. Interrupt a stream and restart the backend. Confirm recovery without another message POST or false success.
5. Check validation, missing conversations, conflicts, unavailable states, and retained drafts.
6. Check both themes, saved choice, keyboard use, reduced motion, and a narrow mobile layout.
7. Start the stack after credential preparation and device approval. Confirm the browser uses only Hono.

Prefer manual browser checks and a few meaningful Vitest integration checks with controlled HTTP/SSE responses.
Do not add shallow component tests or restore the gateway harness.
Obtain a new paid-call budget before live model checks. This PRD does not authorize those calls.
