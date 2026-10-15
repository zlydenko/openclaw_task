import { useEffect, useRef } from "react";

import { isBusy } from "../state.ts";
import type { SidebarProps } from "../types.ts";

export function Sidebar({
  state,
  open,
  mobile,
  select,
  create,
  more,
  close,
  theme,
  toggleTheme,
}: SidebarProps) {
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (mobile && open)
      panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [mobile, open]);

  return (
    <>
      {open && (
        <button className="sidebar-scrim" aria-label="Close conversations" onClick={close} />
      )}
      <aside
        ref={panel}
        inert={mobile && !open}
        className={`sidebar ${open ? "is-open" : ""}`}
        aria-label="Conversations"
        id="conversations"
      >
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ✳
          </span>{" "}
          openclaw <span className="local-badge">local</span>
        </div>
        <button
          className="new-conversation"
          onClick={create}
          disabled={state.creating || !state.ready}
        >
          <span aria-hidden="true">＋</span>
          {state.creating ? "Creating…" : "New conversation"}
        </button>
        <div className="section-label">
          Conversations <span>{state.items.length.toString().padStart(2, "0")}</span>
        </div>
        <nav className="conversation-list" aria-label="Conversation list">
          {state.items.map((item) => (
            <button
              key={item.id}
              className={`conversation ${state.selected === item.id ? "is-selected" : ""}`}
              aria-current={state.selected === item.id ? "page" : undefined}
              onClick={() => select(item.id)}
            >
              <span className="conversation-title">{item.title || "New conversation"}</span>
              <span className="conversation-meta">
                {item.updatedAt
                  ? new Date(item.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                  : item.id.slice(0, 8)}
                {item.updatedAt && !item.title && ` · ${item.id.slice(0, 8)}`}
                {isBusy(state.turns[item.id]?.phase) && <span> · In progress</span>}
              </span>
            </button>
          ))}
          {!state.items.length && !state.listLoading && (
            <p className="sidebar-empty">Your conversations will appear here.</p>
          )}
          {state.listLoading && (
            <p className="sidebar-empty" role="status">
              Loading conversations…
            </p>
          )}
          {state.listError && (
            <p className="sidebar-error" role="alert">
              {state.listError}
            </p>
          )}
          {state.nextCursor && (
            <button className="text-button load-more" disabled={state.listLoading} onClick={more}>
              Load more
            </button>
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="workspace-label">
            <span className="workspace-avatar" aria-hidden="true">
              A
            </span>
            <div>
              Local workspace<small>Single user · private gateway</small>
            </div>
          </div>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            <span aria-hidden="true">{theme === "dark" ? "☼" : "☾"}</span>
            <span>{theme === "dark" ? "Light" : "Dark"} appearance</span>
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </aside>
    </>
  );
}
