import { useEffect, useRef } from "react";

import type { SettingsPanelProps } from "../types.ts";

export function SettingsPanel({ controller, state, open, close }: SettingsPanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    controller.setVisible(open);
    if (open) heading.current?.focus();
  }, [controller, open]);
  const data = state.current;
  const base = state.saved;
  const changed =
    base &&
    (state.chatModel !== base.chatModel ||
      state.imageModel !== base.imageModel ||
      Object.keys(state.toolChanges).length > 0);
  const waiting = data?.admission.unresolved
    ? "Checking OpenClaw run status…"
    : data?.admission.activeTurns
      ? "Awaiting OpenClaw agents to finish…"
      : "";
  const fileBlocked =
    !data?.canEdit ||
    !data.admission.ready ||
    data.admission.locked ||
    !!data.admission.activeTurns ||
    !!state.pending;
  return (
    <section
      className="settings-panel"
      hidden={!open}
      aria-label="Settings"
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <div className="settings-heading">
        <h1 ref={heading} tabIndex={-1}>
          Settings
        </h1>
        <button className="text-button" onClick={close}>
          Back to chat ×
        </button>
      </div>
      <p>Changes apply to later turns. Existing messages stay unchanged.</p>
      <nav className="settings-actions" aria-label="Settings sections">
        {[
          ["models", "Models"],
          ["tools", "Tools"],
          ["review", "Review changes"],
          ["files", "Profile and memory"],
          ["gateway", "Gateway"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => document.getElementById("settings-" + id)?.scrollIntoView()}
          >
            {label}
          </button>
        ))}
      </nav>
      <p className="settings-status" role="status">
        {state.pending
          ? state.pending === "config"
            ? "Applying settings…"
            : `Saving ${state.pending}…`
          : state.result || waiting}
      </p>
      {waiting && (
        <p>
          <span className="settings-loader" aria-hidden="true" />
          {waiting}{" "}
          {data?.admission.activeTurns ? `(${data.admission.activeTurns} application turns)` : ""}
          <small>
            {data?.admission.unresolved
              ? "The app must confirm run outcomes before saving."
              : "Current turns keep their settings and context. Save your changes after they finish."}
          </small>
        </p>
      )}
      {state.error && (
        <p role="alert" className="settings-error">
          {state.error}{" "}
          <button onClick={() => void controller.refresh()}>
            Load current values for comparison
          </button>
        </p>
      )}
      {!data && <button onClick={() => void controller.refresh()}>Read settings</button>}
      {data && base && (
        <>
          {!data.canEdit && (
            <p className="notice-banner">
              Read-only. Approve the backend device scope upgrade through the documented setup
              procedure. Chat remains available.
            </p>
          )}
          {data.gateway.reloadMode !== "hybrid" && (
            <p className="notice-banner">
              Config writes require hybrid reload mode. Use native maintenance. File saves remain
              independent.
            </p>
          )}
          <section id="settings-models" className="settings-section">
            <h2>Models</h2>
            {(["chatModel", "imageModel"] as const).map((slot) => {
              const model = data.models.find((row) => row.id === state[slot]);
              return (
                <div className="model-choice" key={slot}>
                  <label>
                    {slot === "chatModel" ? "Chat model" : "Image-analysis model"}
                    <select
                      value={state[slot]}
                      disabled={!data.canEdit || !!state.pending}
                      onChange={(event) => controller.changeModel(slot, event.target.value)}
                    >
                      {!data.models.some((row) => row.id === state[slot]) && (
                        <option value={state[slot]}>
                          {state[slot] || "No default configured"} (saved selection)
                        </option>
                      )}
                      {data.models.map((row) => (
                        <option
                          key={row.id}
                          value={row.id}
                          disabled={slot === "imageModel" && !row.input.includes("image")}
                        >
                          {row.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {model && (
                    <small>
                      Catalog capability advertised: {model.input.join(" + ")}; tools:{" "}
                      {model.tools ? "yes" : "no"}. Context: {model.contextWindow.toLocaleString()}.
                      Output cap: 4096 tokens. Transport: {model.api}.<br />
                      USD ${model.inputPrice} input / ${model.outputPrice} output per million
                      tokens, {model.priceDate}. Tiered rates and other charges can apply.
                      <br />
                      Verified in this application: {model.verified}.{" "}
                      <a
                        href={`https://openrouter.ai/${model.id.slice(11)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Model details ↗
                      </a>
                    </small>
                  )}
                </div>
              );
            })}
            <p>
              A vision-capable chat model receives images directly. The separate image model serves
              native tool-based analysis when needed. It does not generate images.
            </p>
            <p>
              {data.overrides.notice}{" "}
              {data.overrides.chatModel && `Main-agent chat override: ${data.overrides.chatModel}.`}{" "}
              {data.overrides.imageModel &&
                `Main-agent image override: ${data.overrides.imageModel}.`}
            </p>
          </section>
          <section id="settings-tools" className="settings-section">
            <h2>Tools</h2>
            <p>
              These switches change exact tool policy. They do not grant service access or execution
              permission.
            </p>
            <div className="tool-settings">
              {base.tools.map((tool) => (
                <label className="tool-setting" key={tool.id}>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={state.toolChanges[tool.id] ?? tool.enabled}
                    disabled={!data.canEdit || !tool.editable || !!state.pending}
                    onChange={(event) => controller.toggle(tool.id, event.target.checked)}
                  />
                  <span>
                    <strong>{tool.label}</strong> <code>{tool.id}</code>
                    <small>
                      {tool.description}
                      <br />
                      {tool.reason}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            {base.tools.some(
              (tool) => tool.id === "image" && !(state.toolChanges[tool.id] ?? tool.enabled),
            ) && (
              <p>
                Image inspection is disabled. The image-model choice is retained. Native vision
                input can still work.
              </p>
            )}
          </section>
          <section id="settings-review" className="settings-section">
            <h2>Review configuration changes</h2>
            {data.baseHash !== base.baseHash && (
              <p className="settings-error">
                The saved configuration changed. Your draft retains its original revision. Compare
                below, then discard to load the current values.
              </p>
            )}
            <ul>
              {(["chatModel", "imageModel"] as const)
                .filter((slot) => state[slot] !== base[slot] || data[slot] !== base[slot])
                .map((slot) => (
                  <li key={slot}>
                    {slot}: saved {base[slot]} → draft {state[slot]}. Current: {data[slot]}
                  </li>
                ))}
              {Object.entries(state.toolChanges).map(([id, enabled]) => (
                <li key={id}>
                  {id}: {base.tools.find((tool) => tool.id === id)?.enabled ? "On" : "Off"} →{" "}
                  {enabled ? "On" : "Off"}. Current:{" "}
                  {data.tools.find((tool) => tool.id === id)?.enabled ? "On" : "Off"}
                </li>
              ))}
            </ul>
            {!changed && <p>No configuration changes.</p>}
            <div className="settings-actions">
              <button
                className="primary-button"
                disabled={!changed || !data.canApply || !!state.pending || !!state.error}
                onClick={() => void controller.apply()}
              >
                Apply changes
              </button>
              {waiting && (
                <span>
                  <span className="settings-loader" aria-hidden="true" /> {waiting}
                </span>
              )}
              <button disabled={!!state.pending} onClick={() => controller.discard()}>
                Discard changes / use current
              </button>
            </div>
          </section>
          <section id="settings-files" className="settings-section">
            <h2>Profile and memory</h2>
            <p>
              Shared files for this local agent. Saved content remains subject to native context
              budgets, session privacy, and memory provenance. Storage capacity does not mean all
              text enters the prompt. Native conflict checks are best effort for independent
              filesystem writers.
            </p>
            {(["USER.md", "MEMORY.md"] as const).map((name) => {
              const editor = state.files[name];
              const dirty =
                editor.saved &&
                (editor.draft !== editor.saved.content || (editor.saved.missing && editor.editing));
              const bytes = new TextEncoder().encode(editor.draft).length;
              return (
                <article className="file-editor" key={name}>
                  <h3>
                    {name} {dirty ? "· Unsaved" : ""}
                  </h3>
                  <p>
                    {name === "USER.md"
                      ? "Stable preferences and communication guidance."
                      : "Durable facts, decisions, and summaries."}{" "}
                    {editor.saved?.missing ? "Missing. An explicit save creates this file." : ""}
                  </p>
                  {editor.saved && (
                    <>
                      <details>
                        <summary>Saved version</summary>
                        <pre>{editor.saved.content || "(Empty file)"}</pre>
                      </details>
                      {editor.editing ? (
                        <label>
                          Markdown source
                          <textarea
                            value={editor.draft}
                            onChange={(event) => controller.editFile(name, event.target.value)}
                            spellCheck={false}
                          />
                        </label>
                      ) : (
                        <pre>
                          {editor.saved.content ||
                            (editor.saved.missing ? "Missing" : "(Empty file)")}
                        </pre>
                      )}
                      <small>
                        {Array.from(editor.draft).length} characters · {bytes.toLocaleString()} /
                        65,536 UTF-8 bytes
                      </small>
                      {bytes > 65536 && (
                        <p role="alert">
                          Content exceeds the storage limit. Shorten the draft before saving.
                        </p>
                      )}
                      {editor.current && (
                        <details open>
                          <summary>Current saved version for comparison</summary>
                          <pre>{editor.current.content || "(Empty or missing)"}</pre>
                        </details>
                      )}
                      <div className="settings-actions">
                        <button onClick={() => controller.editFile(name)}>Edit</button>
                        <button
                          disabled={!dirty || fileBlocked || bytes > 65536}
                          onClick={() => void controller.saveFile(name)}
                        >
                          Save {name}
                        </button>
                        {waiting && (
                          <span>
                            <span className="settings-loader" aria-hidden="true" /> {waiting}
                          </span>
                        )}
                        <button
                          disabled={!!state.pending}
                          onClick={() => controller.discardFile(name)}
                        >
                          Discard / use saved
                        </button>
                      </div>
                    </>
                  )}
                  <button className="text-button" onClick={() => void controller.loadFile(name)}>
                    Reload saved version for comparison
                  </button>
                  <p role="status">{editor.result}</p>
                  {editor.error && (
                    <p className="settings-error" role="alert">
                      {editor.error}
                    </p>
                  )}
                </article>
              );
            })}
          </section>
          <section id="settings-gateway" className="settings-section">
            <h2>Gateway</h2>
            <dl>
              <dt>Version</dt>
              <dd>{data.gateway.version}</dd>
              <dt>Connection</dt>
              <dd>{state.indicator?.label ?? data.gateway.label}</dd>
              <dt>Reload mode</dt>
              <dd>{data.gateway.reloadMode}</dd>
              <dt>Internal bind / port</dt>
              <dd>
                {data.gateway.bind} / {data.gateway.port}
              </dd>
              <dt>Authentication enabled</dt>
              <dd>{data.gateway.authenticationEnabled ? "Yes" : "No"}</dd>
            </dl>
          </section>
        </>
      )}
    </section>
  );
}
