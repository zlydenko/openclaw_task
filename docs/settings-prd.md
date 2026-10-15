# OpenClaw settings UI PRD

Status: draft for review. Implementation is not authorized by this document.
Design date: 2026-10-15.

## Goal and scope

Let the local owner select the chat model, select the image-analysis model, and turn individual agent tools on or off.
Let the owner review and edit the main agent's USER.md and MEMORY.md files.
Save config choices in the running gateway's persistent openclaw.json and file edits in its persistent workspace through official OpenClaw RPC.
Use the existing React interface, Hono backend, and one gateway.

The first version includes a Settings panel, a short model list with prices, tool toggles, USER.md and MEMORY.md editors, a change review, and application status.
Create either workspace file if it is missing when the gateway container starts.
Gateway network and security settings are read-only.
Run limits, raw JSON editing, credential editing, plugin installation, provider setup, image generation, and container management are outside this version.
Keep the current three-run limit, run timeout, memory limits, execution permissions, and disabled services.

This proposal extends the config restrictions in the [backend PRD](backend-prd.md) only for the fields listed below.
The [frontend PRD](frontend-prd.md) still governs conversation observation and recovery.

## Configuration and reload behavior

The active file is /home/node/.openclaw/openclaw.json in gateway_state.
The entrypoint copies docker/openclaw.json only when that file does not exist.
The repository file is a fresh-install seed. A rebuild does not replace saved settings.
Keep one source of truth in OpenClaw. Do not maintain a second application config file.

OpenClaw 2026.10.3 classifies changes as a hot reload, a gateway restart, or a snapshot update without a reload action.
Hybrid mode applies the native plan. A hot reload can refresh an internal subsystem while the gateway continues to serve.
Unknown paths can require a restart. These rules have exceptions for individual gateway fields.
See the [pinned reload rules](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/gateway/configuration/hot-reload.md).

| Change | Required action |
| --- | --- |
| Chat model, image-analysis model, and tool policy in this version | Native hot application. No image rebuild. |
| USER.md and MEMORY.md edits | Save through native workspace-file RPC. Native context loading governs later turns; no gateway restart or image rebuild. |
| Listener port, bind address, authentication mode, or TLS setup | Native gateway restart and deployment checks. Outside this version. |
| Compose environment, mounts, secret sources, or resource limits | Host-managed container recreation as needed. Outside this version. |
| OpenClaw version, application code, or image contents | Build or obtain an updated image and recreate its container. Outside this version. |

Agent turns run under the gateway. This project has no separate agent service to restart for each conversation.
Do not restart Hono, the gateway container, or the full stack after an ordinary settings save.
Require hybrid reload mode for UI config writes. If reload is off, show a maintenance message and leave the config draft available.
Workspace-file saves do not depend on the config reload mode.
Do not change reload mode implicitly.

## Settings interface

Make the existing visible user profile component in the bottom-left corner of the sidebar clickable.
Use it as the entry point: User profile → Settings.
Clicking the profile component opens a profile menu with a labelled Settings action. Selecting Settings opens the Settings panel.
Keep the current profile appearance and position. Provide a pointer cursor, keyboard activation, and visible focus for the profile button and Settings action.
Keep this entry point available in the sidebar on narrow screens. Closing Settings returns to the selected conversation without losing drafts or run observation.
Keep Settings independent of the selected conversation.
Keep active streams and run observation mounted while Settings is open.
Support both themes, keyboard navigation, visible focus, and a narrow screen.

Show four sections:

- Models: Chat model and Image-analysis model selectors.
- Tools: Individual switches with a tool name, short purpose, and availability reason.
- Profile and memory: USER.md and MEMORY.md review and text editors with independent save controls.
- Gateway: Read-only version, connection state, reload mode, internal bind/port, and whether authentication is enabled. Never show credentials.

Keep configuration edits in memory until the owner selects Apply changes.
Each workspace-file editor has its own explicit Save action. Do not combine file saves and config application into one transaction.
Show a bounded before/after summary and the notice: Changes apply to later turns. Existing messages stay unchanged.
Provide Discard changes. Disable Apply when there is no change, validation fails, settings access is unavailable, or a turn is active or unresolved.
Keep drafts during navigation and rejected writes. Do not save config drafts in browser storage.
A page refresh discards an unsaved draft and reads the gateway again.

### Waiting for active turns

While application turns are active or awaiting gateway acceptance, show a small loader beside the disabled Apply or file Save control:
**Awaiting OpenClaw agents to finish…**
Show the helper text: Current turns keep their settings and context. Save your changes after they finish.
Keep settings editable, preserve the draft, and keep Discard and conversation navigation available.
The loader describes waiting for the application's turns. It does not mean that settings are saved or being applied.

Use authoritative backend run state across all application conversations and tabs. Do not check only the selected conversation.
Show the active-turn count only when the backend supplies it. Do not show an estimated finish time or percentage.
If any run outcome is unresolved, show **Checking OpenClaw run status…** and explain that the app must confirm the outcome before applying changes.
Do not describe an unresolved run as definitely still running.

Refresh this state through read-only polling and existing run observations. Do not interrupt live streams or send a settings mutation while waiting.
When all blocking reservations clear and the gateway is ready, remove the waiting loader and enable the applicable Apply or Save control for a valid changed draft.
The owner must still select Apply changes or the file's Save control. Finishing a turn does not save or apply any draft automatically.
After that explicit action, use **Applying settings…** for config application or **Saving USER.md…** / **Saving MEMORY.md…** for a file save until the native result is confirmed.
Respect reduced motion and announce status changes politely without announcing each animation frame.

### Gateway indicator during settings changes

Use the existing gateway health indicator in the top-right corner of the UI to show settings application and native lifecycle transitions.
Keep this indicator visible and consistent in Settings and chat, independent of the selected conversation.
Read its state from backend application status and native connection/readiness evidence. A click or timer must not imply that a process is reloading.

| Observed state | Indicator label and behavior |
| --- | --- |
| Waiting for active turns before Apply or Save | Keep the actual gateway health state. Show Awaiting OpenClaw agents to finish… in Settings; waiting is not a reload. |
| Config application is pending without a process restart | Show Updating settings… with a yellow (amber) transition indicator. Do not label a hot application as a process restart. |
| Native gateway/agent runtime restart is confirmed | Show Reloading agent… with a yellow (amber) transition indicator while the runtime reloads. Do not keep a green Connected label throughout the restart. |
| Connection is being restored or state is being reconciled | Show Reconnecting… or Recovering… with a yellow (amber) transition indicator. |
| Native application is confirmed and authenticated readiness and recovery pass | Return to the green Connected indicator. Connection alone does not confirm settings application. |
| Application cannot yet be confirmed, with no confirmed failure | Show yellow (amber) Settings unconfirmed with a safe reason. Do not claim success or a confirmed failure. |
| Reload is confirmed failed or the gateway is unavailable | Show red Reload failed or Gateway unavailable with a safe reason. Do not return to green success merely because time elapsed. |

Use green for confirmed readiness, yellow (amber) for transitions or uncertainty, and red for confirmed failure or unavailability.
A confirmed failure or unavailable state takes precedence over a concurrent transition. Mere active conversation work does not change gateway health colour.
Use text as well as colour. Give transition states a small loader that respects reduced motion.
An ordinary USER.md or MEMORY.md save must not show Reloading agent… unless a native restart actually occurs.
The indicator observes lifecycle state; it must not restart the process or retry config, file, message, or tool mutations.

## Tool toggles

Read tool IDs and labels from official tools.catalog for the main agent.
Use native effective-tool information where available to explain restrictions.
A catalog row alone does not prove that its service, credentials, or execution permission is available.
See the [pinned catalog handler](https://github.com/openclaw/openclaw/blob/v2026.10.3/src/gateway/server-methods/tools-catalog.ts).

Keep the current full tool profile, tool search, and code-mode settings.
For an ordinary editable tool, Off adds its exact ID to tools.deny. On removes that exact deny.
Preserve all other tools fields and all unrelated deny entries.
Do not write a blanket deny list or convert the configuration to a new allowlist.

A group deny, wildcard, provider restriction, per-agent policy, or disabled service can still block a tool.
Show that restriction and prevent a misleading On state. Do not remove broad policies to enable one tool.
Preserve unknown entries. Treat unsupported policy combinations as read-only with a clear reason.
Tools unavailable because of browser, cron, memory, plugin, or elevated-execution settings stay unavailable.
A toggle changes tool policy. It does not enable those services or grant execution permission.

Use exact discovered IDs, including the image-inspection tool ID reported by the pinned runtime.
Do not assume write, edit, and apply_patch are interchangeable.
The native policy gives denies precedence and supports group and wildcard entries; see [tool policy](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/gateway/config-tools/tool-policy.md).

If image inspection is disabled, retain the image model choice and show that tool-based analysis is unavailable.
Native vision input can still work when the selected chat model accepts images.
Turning off a tool is a policy change for subsequent use. It is not an emergency cancellation control.

## Profile and memory files

### Review and edit

Use the main agent's configured workspace. Its current path is /home/node/.openclaw/workspace inside gateway_state.
Resolve the target on the server. Do not accept a browser-supplied workspace, agent ID, or filesystem path.
This version exposes only the exact names USER.md and MEMORY.md. It is not a general file browser.

USER.md holds stable user preferences and communication guidance. MEMORY.md holds durable facts, decisions, and summaries.
These are shared workspace files for this local single-user agent, not per-conversation files or multi-user personal profiles.
Follow the [native workspace file roles](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/concepts/agent-workspace.md).

Show the saved content in a selectable text view and provide Edit, Save, and Discard controls for each file.
Use a plain text editor with Markdown source. Do not execute file contents or render unsanitized HTML.
Show the exact filename, dirty state, character count, and save result. Let the owner review the saved version against the draft before saving.
Switching editors or returning to chat preserves both drafts in memory. Reads and status refreshes must not replace a dirty draft.
A page refresh discards unsaved drafts. Do not store private file content in browser storage or logs.

Read with agents.files.get and save with agents.files.set through the official gateway client.
Pass the returned file hash as expectedHash for an existing file, or expectedMissing: true when explicitly creating an absent file.
The installed 2026.10.3 protocol supports these revision guards. Do not use the config baseHash as a file revision.
A conflicting edit from another tab or agent preserves the draft and offers reload and comparison. Never overwrite or merge automatically.
Native conflict checks against independent filesystem writers are best effort; the UI must not claim universal file locking.

Each save uses the same atomic admission gate and idle checks as config application.
This avoids overlapping a UI file save with the application's active agent turns, including agent memory writes during those turns.
The Awaiting OpenClaw agents to finish… loader applies to both file editors. Unknown run outcomes use Checking OpenClaw run status….
Keep review and editing available while Save is disabled. Do not save automatically when the wait ends.
Serialize file saves and config changes; each has its own result. A successful USER.md save does not imply that MEMORY.md or config was saved.

Allow an explicit empty-content save. Do not treat an empty file as missing or restore default content over it.
Bound each full file read and save to 64 KiB of UTF-8, with a 128 KiB JSON request limit on file-save routes only.
If an existing file exceeds the read limit, show a read-only size error. Never save a truncated view over the full file.
Show context-budget warnings separately from storage limits. The editor must not imply that all saved content fits in the model prompt.

On success, verify the native saved content and revision. Report Saved, not Agent has read this file.
On lost acknowledgement, read the file again and reconcile. Do not retry the write automatically.
Retain the draft and show a conflict or unknown outcome when read-back cannot confirm the intended save.
Use no-store responses. Keep file bodies out of generic settings responses, telemetry, error messages, and changelog entries.

### Create missing files at container startup

Add a gateway-local startup step after initial config seeding and before the gateway starts accepting requests.
Resolve the main agent's workspace from the saved config. Use the current configured workspace, not the image's seed config or the backend filesystem.
Keep this workspace in the persistent gateway_state volume. Do not add a host mount or grant Hono direct volume access.
If the saved workspace cannot be resolved safely within the supported persistent location, stop with a safe setup error instead of creating files elsewhere.

Create USER.md and MEMORY.md independently only when absent, including on installations with an existing gateway volume.
Use exclusive creation as the gateway user. Do not truncate an existing file, replace a symlink, follow a path outside the workspace, or reset a zero-byte file.
Use private file permissions and preserve existing file bytes and ownership.
Seed only a Markdown heading: # User followed by a newline, or # Memory followed by a newline.
Do not invent user preferences, import host files, copy conversations, or make a model request to initialize them.
Preserve OpenClaw's native workspace initialization and memory provenance handling. Do not manufacture provenance records or bypass trust checks.

If one file exists and the other is absent, preserve the existing file and create only the missing file.
If creation or access validation fails, fail startup with the filename and a safe reason. Do not claim readiness with failed initialization.
If a file is later removed while the gateway is running, show Missing. An explicit Save can create it with expectedMissing: true; a GET must not create it.
A later container start creates any missing file again. Existing content survives restart and container recreation while gateway_state is retained.
This startup requirement is part of the proposed implementation; the current entrypoint only seeds openclaw.json.

### Loading into agent context

Saving USER.md or MEMORY.md needs no gateway restart, Hono restart, or container rebuild.
Use OpenClaw's native bootstrap refresh and memory-loading rules for later eligible turns and sessions.
Do not rewrite an active prompt, reset a conversation, or submit a synthetic message to make the agent reread a file.
USER.md has its own native context budget. MEMORY.md remains subject to eligible private-context and provenance rules.
Editing MEMORY.md does not enable memory services, rebuild indexes through a custom path, or override session privacy restrictions.
See the [pinned user model](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/concepts/user-model.md) and [memory behavior](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/concepts/memory.md).

## Model selection

Chat model writes agents.defaults.model.primary.
Image-analysis model writes agents.defaults.imageModel.primary.
Normalize supported string and object config forms without losing existing fallback lists.
Preserve explicit agent and conversation overrides. Show when an override takes precedence; do not rewrite saved sessions to force a default.

Both selectors use OpenRouter through the existing file SecretRef.
OpenClaw model references have the form openrouter/<OpenRouter model ID>.
Accept only reviewed catalog IDs from the backend. Keep the current saved selection visible even if it is outside the shortlist.
Do not accept browser-supplied provider URLs, credentials, API modes, prices, context limits, or model definitions.

The chat selector controls the default model for later turns that inherit that default, including later turns in existing conversations.
It does not regenerate messages or transfer an in-flight run to another model.
The image selector controls native image-analysis routing, not image generation.
A native-vision chat model receives image bytes directly. The separate image model is used when the active model cannot accept images and the native analysis path needs it.
Explain this beside the image selector. Follow the [pinned model-slot behavior](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/gateway/config-agents/models.md).

Ship a small reviewed catalog with model IDs, supported input, tool capability, API transport, context limits, and a price date.
Register a missing selected model through the same native config patch before referencing it.
Merge provider model entries by ID. Preserve existing rows, fallbacks, allowlists, and custom fields.
If a configured model allowlist would block the choice, add only the selected reviewed reference as part of the reviewed change, or report the conflict.
Do not overwrite custom transport settings for an existing model automatically.
New candidates should use a reviewed per-model transport, normally OpenRouter chat completions, without changing Kimi's existing Responses API setting for other models.
Keep the 4096-token application model output cap. Do not copy a large provider maximum into the runtime limit.

Opening Settings, reading metadata, and applying config must not make inference requests.
Show Catalog capability advertised separately from Verified in this application.
Successful config validation does not prove streaming, image recognition, or tool-call compatibility.
Model calls occur only through the native agent flow. No new backend inference client is required.

## Initial low-cost model shortlist

Prices below are listed USD per one million input/output tokens, checked on 2026-10-16.
They are indicative model-page rates. Provider routes, caching, reasoning, image tokenization, and other charges can change the final cost.
Use a reviewed dated list. Do not change the selected model automatically when prices or rankings change.

| Model and OpenRouter ID | Input | Output | Selector use | Reason to include |
| --- | --- | --- | --- | --- |
| [Qwen3.7 Flash](https://openrouter.ai/qwen/qwen3.7-flash), qwen/qwen3.7-flash | $0.03 | $0.13 | Chat and image analysis | Lowest output price in this shortlist; advertises vision and tools. |
| [MiMo-V2.6-Flash](https://openrouter.ai/xiaomi/mimo-v2.6-flash), xiaomi/mimo-v2.6-flash | $0.10 | $0.28 | Chat and image analysis | Low output price; current high usage; advertises vision and tools. |
| [DeepSeek V4.1 Flash](https://openrouter.ai/deepseek/deepseek-v4.1-flash), deepseek/deepseek-v4.1-flash | $0.036 | $0.684 | Chat and image analysis | Current usage leader; advertises vision and tools. |
| [GLM 5.3 Flash](https://openrouter.ai/z-ai/glm-5.3-flash), z-ai/glm-5.3-flash | $0.01332 | $0.90 | Chat and image analysis | Current high usage; inexpensive input; advertises vision and tools. |
| [Gemini 2.5 Flash Lite](https://openrouter.ai/google/gemini-2.5-flash-lite), google/gemini-2.5-flash-lite | $0.10 | $0.40 | Image analysis initially | Existing image configuration and low-cost baseline. |

The [OpenRouter usage ranking](https://openrouter.ai/rankings), with data through 2026-10-15, places DeepSeek V4.1 Flash first, GLM 5.3 Flash third, and MiMo-V2.6-Flash fourth.
Popularity here means OpenRouter token traffic, not verified application quality.
Qwen is the low-price alternative. Gemini is the existing baseline. Neither is labelled a top-three model.

Keep Kimi K2 Thinking as the current chat choice until the owner explicitly selects another model.
Keep Gemini as the current image choice.
Candidates enter the selectors only after their exact IDs, modalities, transport, and pinned OpenClaw preparation have been checked.
Disable unavailable choices with a reason. Paid outcome verification remains separate and opt-in.
The low-cost trial recommendation is Qwen3.7 Flash; MiMo is the next candidate for a usage-backed comparison.

## Apply transaction

The transaction below applies to configuration only. Workspace files use their independent guarded saves and the same admission gate.

### Why application waits until idle

Wait until idle to put configuration changes and workspace-file saves between application turns.
This gives the owner a clear boundary: current turns finish before the new model defaults and tool policy take effect.
It avoids overlapping an application turn with tool-policy changes, model-runtime preparation, or dependent subsystem reloads.
For USER.md and MEMORY.md, the same rule separates manual saves from agent memory writes and changes to context inputs.
It also reduces interruption and uncertain outcomes if native application needs restart recovery.
OpenClaw supports hot changes during active work; this wait is an application policy for predictable behavior, not a general OpenClaw requirement.
The guarantee covers the application's admitted turns. Other clients remain subject to OpenClaw's native lifecycle rules.

### Apply steps

Use one explicit Apply action. Do not autosave or queue a settings change.
If a turn is running, the owner can keep editing and apply after it finishes.
The backend returns a conflict for active, pending, or unresolved application runs, including runs started in another tab.
A cancellation request does not make a run idle until its outcome is confirmed.

1. Validate the small settings payload and acquire a settings mutation gate synchronously with chat run admission.
2. Recheck gateway readiness, run reservations, permissions, and hybrid mode. Reject a competing apply or message admission without sending upstream work.
3. Read config.get and compare its hash with the draft baseHash. A stale draft returns a conflict; preserve the draft and offer a comparison with current values.
4. Build one partial config.patch containing only the reviewed changes. Use the native baseHash guard. For intentional tools.deny array replacement, send the exact replacePaths entry and retain unrelated values.
5. Let OpenClaw validate, persist, and apply the change. The backend must not write the gateway volume directly.
6. Read back the selected values and retain the runtime application result. Report Applied only after native application is confirmed. Release the gate when the result is known and admission is safe.

Use config.schema.lookup to check the editable subtrees against the installed release.
Do not use config.set as evidence of runtime application or config.apply as an ordinary full-file save.
For hot changes, the pinned config.patch waits for application. A persisted-config receipt in an error proves only a disk write.
An unchanged retry can be a no-op and cannot prove that a failed application recovered.
See the [pinned config RPC contract](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/gateway/configuration/config-rpc.md).

The gate lives with chat admission. HTTP middleware and disabled browser buttons cannot provide atomic protection.
Keep it through a browser disconnect while the backend tracks the native write.
No client or backend layer retries a settings mutation automatically.
A timed-out or disconnected write enters Checking application state. Read before deciding whether it committed.
If runtime application cannot be established, show Saved but not confirmed or Outcome unknown and keep new submissions blocked while recovery is required.
Do not infer application from matching saved values, a healthy process, or a timer.

## Conversations and recovery

Saved conversations and retained images remain in gateway_state.
No settings operation resets, migrates, deletes, or recreates session stores or device identities.
An idle conversation does not prevent application. A running turn does.
Draft text and images stay in the browser during Settings navigation.

The gate covers application submissions handled by Hono.
It cannot stop the terminal client or another gateway client from starting work.
For those clients, OpenClaw owns hot application, active-work handling, and native restart deferral.
Do not claim a global idle guarantee from the application's three-run map.

The first version provides no Restart now or Force restart button.
If native application needs restart recovery, show Applying, Gateway restarting, Reconnecting, then Applied only after evidence confirms it.
Keep gateway reconnect and history reconciliation independent of the selected conversation.
Do not resend messages, attachments, or tool calls. Keep uncertain run outcomes visible.
Saved history survives a restart; an in-flight request is not a guaranteed resumable computation.

A future restart control must use the official gateway lifecycle and test its drain and relaunch behavior in this exact container setup.
A safe restart has a bounded wait and can eventually cancel outstanding work; it is not a promise to preserve every active turn.
See [restart and supervision](https://github.com/openclaw/openclaw/blob/v2026.10.3/docs/cli/gateway/restart-and-supervision.md).
The current Compose service has no restart policy. A gateway process exit must not be assumed to relaunch automatically.
Keep container restart and recreation as host maintenance. Mounting the Docker socket is not part of this design.

## Backend contract and permissions

| Method and path | Result |
| --- | --- |
| GET /api/settings | Safe editable projection, baseHash, current application state, apply eligibility and blocking-run reasons, model shortlist, tool rows, and read-only gateway summary. |
| PATCH /api/settings | Explicit change payload with baseHash. Return confirmed values on success, or a safe validation, conflict, permission, or unavailable error. |
| GET /api/settings/files/:name | Exact USER.md or MEMORY.md content, missing state, size, and revision. No filesystem paths. |
| PUT /api/settings/files/:name | Explicit whole-file save with content and expectedHash, or expectedMissing: true. Native guarded write and verified saved revision. |

Use fields chatModel, imageModel, and toolChanges, where toolChanges maps reviewed exact IDs to booleans.
Omitted fields stay unchanged. Require at least one actual intended change.
Reject unknown fields, unknown IDs, more than 128 tool changes, and config request bodies above 16 KiB.
File routes accept only the two exact filenames. Reject unknown fields and invalid revision guards. Use the separate file-content and request limits above.
Return 413 for an excessive file payload. A file conflict returns 409 and never writes over the newer revision.
Use 400 for invalid input, 403 for missing settings permission, 409 for a stale draft or admission conflict, and 503 for unavailable or uncertain application.
Read-only polling can refresh status. It must not repeat PATCH.
After a backend restart, re-read native config and complete normal run recovery before admission returns. Never replay a pending write.
If the installed protocol cannot prove a saved revision is active, retain uncertainty and provide native maintenance guidance.

The current backend requests operator.read and operator.write.
Config and agents.files.set writes require operator.admin; config, file, and schema reads use operator.read.
Add admin to the same persistent backend device only when this feature is implemented and document the exact scope-upgrade approval procedure.
Do not silently approve that device request or request unrelated pairing or approval scopes.
Until the upgrade is approved, show read-only settings and leave ordinary chat usable.
If an admin-scope handshake is refused, retain the identity and existing token and reconnect with the previously approved chat scopes.
Do not leave chat unavailable because an optional settings scope is missing.
See the [pinned method permission table](https://github.com/openclaw/openclaw/blob/v2026.10.3/src/gateway/methods/core-descriptors.ts).

Admin is a broad gateway privilege. Expose only the narrow settings projection, patch builder, and two allowed workspace-file operations through Hono.
Keep Host and Origin checks, JSON validation, no-store responses, the loopback HTTP binding, device checks, and the private gateway port.
Do not expose raw RPC or config contents to the browser.
Keep credentials, SecretRefs, private filesystem paths, and raw upstream errors out of responses and logs.
Log operation state, allowed filenames, and changed field names without config values or file content.
No extra service, state database, direct tooling, or host-folder mount is required.

## Implementation and acceptance

Keep backend types in apps/api/src/types.ts and frontend types in apps/web/src/types.ts.
Keep route registration, response handling, and reusable request validation in their existing modules.
Add a small settings service and gateway adapter methods. Keep the admission gate in the chat components.
Update the README, architecture, permissions setup, and CHANGELOG when the feature is implemented.
Keep docs/findings.md unchanged.

Use npm run check, npm test, and npm run build for implementation changes.
Extend the existing HTTP/SSE integration checks. Do not restore the removed probe or gateway harness.
Use the manual checks in [verification](verification.md). For runtime changes, also validate Compose, startup config, and basic gateway health.

| Scenario | Required result |
| --- | --- |
| Open Settings from profile | The existing bottom-left profile component opens a menu with Settings. Pointer and keyboard activation open the Settings panel in both themes and on narrow screens without interrupting conversations. |
| Read settings | Show saved choices and restrictions. No secret or paid request. |
| Top-right gateway indicator | Show Updating settings…, confirmed Reloading agent…, and Reconnecting… / Recovering… as applicable. Restore green Connected only after application confirmation, authenticated readiness, and recovery; retain a useful failure or unconfirmed state otherwise. |
| Review workspace files | Show exact saved USER.md and MEMORY.md without exposing arbitrary files or private host paths. Dirty drafts survive navigation and refresh polling. |
| Save workspace files | Apply the idle loader and native revision guards. Save each file independently without config application or restart. |
| Agent or another editor changes a file | Reject a stale revision with 409. Retain the draft. Never overwrite or retry automatically. |
| Fresh or existing gateway volume | Create each missing file at startup with its heading. Preserve every existing file, including empty content. |
| Restart or recreate gateway | Preserve saved file bytes. Recreate only missing files and make no model request. |
| Invalid startup file target or failed creation | Refuse unsafe writes and fail startup with a safe reason. |
| File save acknowledgement lost | Read back to confirm the intended bytes or show uncertainty. Do not repeat the save. |
| File content and context budget | Reject excessive payloads, never overwrite from a truncated read, and distinguish saved content from native prompt inclusion. |
| Model change | Patch the exact selected slots and any required reviewed model row. Preserve existing rows, fallbacks, and transport settings. |
| Tool Off then On | Change only the exact deny entry. Preserve group policies and unavailable-service restrictions. |
| Three active conversations | Show Awaiting OpenClaw agents to finish… beside disabled Apply. Retain streams, editable settings, and drafts across navigation. Reject Apply until all active and unresolved reservations clear. |
| Waiting turn finishes | Remove the loader and enable Apply when the backend confirms readiness. Do not save automatically. |
| Unresolved run | Show Checking OpenClaw run status… and retain the lock until authoritative recovery resolves the blocker. |
| Send races with Apply across tabs | Admit only one side of the atomic gate. No message slips into application. |
| Stale settings in another tab or CLI | Reject the stale baseHash. No overwrite or automatic rebase. |
| Invalid model or tool policy | Native validation rejects the candidate. No false success or implicit service enablement. |
| Native vision versus analysis tool | Explain the route and use the appropriate configured slot without custom replay or image orchestration. |
| Lost apply response or saved-but-unapplied config | Read and reconcile. Keep uncertainty explicit. Never repeat the mutation automatically. |
| Gateway or API restart | Preserve history, images, device identities, and known outcomes. Complete native recovery before new submissions. |
| Missing admin scope | Settings remains read-only. Chat continues with its existing scopes. |

Paid checks require a separate opt-in budget and a fixed small request count.
Use a short streamed answer, one harmless tool outcome, and one image question to assess a candidate when authorized.
Record configuration acceptance separately from paid compatibility results.
