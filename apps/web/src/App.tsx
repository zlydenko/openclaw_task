import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ChatController } from "./chat.ts";
import { Composer } from "./components/Composer.tsx";
import { Messages } from "./components/Messages.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { Waiting } from "./components/Waiting.tsx";
import { SettingsPanel } from "./components/Settings.tsx";
import { SettingsController } from "./settings.ts";
import { activeTurns, isBusy, visibleMessages } from "./state.ts";

const selectedFromHash = () => {
  const id = new URLSearchParams(location.hash.slice(1)).get("conversation");

  return id && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) ? id : null;
};

export function App() {
  const [chat] = useState(() => new ChatController());
  const [settings] = useState(() => new SettingsController());
  const settingsState = useSyncExternalStore(settings.subscribe, settings.snapshot);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const state = useSyncExternalStore(chat.subscribe, chat.snapshot);
  const [sidebar, setSidebar] = useState(false);
  const [mobile, setMobile] = useState(() => matchMedia("(max-width: 640px)").matches);
  const menu = useRef<HTMLButtonElement>(null);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? "dark");
  const id = state.selected;
  const view = id ? state.views[id] : undefined;
  const turn = id ? state.turns[id] : undefined;
  const messages = visibleMessages(view, turn);
  const title =
    state.items.find((item) => item.id === id)?.title ||
    `New conversation${id ? " · " + id.slice(0, 8) : ""}`;
  const active = activeTurns(state);
  const otherRuns = active.filter((run) => run.conversationId !== id);
  const indicator = settingsState.indicator;

  useEffect(() => {
    settings.start();
    return () => settings.close();
  }, [settings]);

  const closeSettings = () => {
    setSettingsOpen(false);
    requestAnimationFrame(() =>
      mobile
        ? menu.current?.focus()
        : document.querySelector<HTMLButtonElement>(".profile-button")?.focus(),
    );
  };

  const closeSidebar = () => {
    setSidebar(false);
    requestAnimationFrame(() => menu.current?.focus());
  };

  useEffect(() => {
    const media = matchMedia("(max-width: 640px)");
    const resize = () => setMobile(media.matches);
    media.addEventListener("change", resize);

    return () => media.removeEventListener("change", resize);
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && sidebar) closeSidebar();
    };
    document.addEventListener("keydown", escape);

    return () => document.removeEventListener("keydown", escape);
  }, [sidebar]);

  useEffect(() => {
    const navigate = () => chat.select(selectedFromHash());
    navigate();
    chat.start();
    window.addEventListener("hashchange", navigate);

    return () => {
      window.removeEventListener("hashchange", navigate);
      chat.close();
    };
  }, [chat]);

  const select = (conversationId: string) => {
    setSettingsOpen(false);
    location.hash = new URLSearchParams({ conversation: conversationId }).toString();
    setSidebar(false);
  };
  const create = async () => {
    const conversationId = await chat.create();
    if (conversationId) select(conversationId);
  };

  return (
    <div className="app-shell">
      <Sidebar
        state={state}
        open={sidebar}
        mobile={mobile}
        select={select}
        create={() => void create()}
        more={() => void chat.loadList(true)}
        close={closeSidebar}
        theme={theme}
        toggleTheme={() => {
          const next = theme === "dark" ? "light" : "dark";
          document.documentElement.dataset.theme = next;
          setTheme(next);
          try {
            localStorage.setItem("openclaw-theme", next);
          } catch {
            /* Storage can be disabled. */
          }
        }}
        openSettings={() => {
          setSettingsOpen(true);
          setSidebar(false);
        }}
      />
      <main className="main-panel" inert={mobile && sidebar}>
        <header className="topbar">
          <div className="topbar-title">
            <button
              ref={menu}
              className="menu-button"
              onClick={() => setSidebar(!sidebar)}
              aria-label="Toggle conversations"
              aria-expanded={sidebar}
              aria-controls="conversations"
            >
              ☰
            </button>
            <span className="breadcrumb">
              Workspace <span aria-hidden="true">/</span>
            </span>
            <span>{settingsOpen ? "Settings" : id ? title : "Conversations"}</span>
          </div>
          <div className="connection">
            <span
              className={`connection-dot ${indicator ? "is-" + indicator.tone : state.ready ? "is-ready" : ""}`}
              aria-hidden="true"
            />
            <span title={indicator?.reason}>{indicator?.label ?? state.connection}</span>
            {indicator?.tone === "amber" && <span className="settings-loader" aria-hidden="true" />}
            {!state.ready && (
              <button className="text-button" onClick={() => void chat.refresh()}>
                Check again
              </button>
            )}
          </div>
        </header>
        <SettingsPanel
          controller={settings}
          state={settingsState}
          open={settingsOpen}
          close={closeSettings}
        />
        <div className="chat-view" hidden={settingsOpen}>
          {otherRuns.length > 0 && (
            <div className="notice-banner">
              {active.length} of 3 conversation slots in use.
              {otherRuns.map((run) => (
                <button
                  key={run.conversationId}
                  className="text-button"
                  onClick={() => select(run.conversationId)}
                >
                  View {run.conversationId.slice(0, 8)} ↗
                </button>
              ))}
            </div>
          )}
          {id ? (
            <>
              {state.errors[id] && (
                <div className="notice-banner" role="alert">
                  {state.errors[id]}
                  <button className="text-button" onClick={() => void chat.loadHistory(id)}>
                    Refresh history
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      location.hash = "";
                    }}
                  >
                    Back to conversations
                  </button>
                </div>
              )}
              {!view ? (
                <div className="center-note" role="status">
                  {state.loading[id] ? "Loading conversation…" : "Conversation unavailable."}
                </div>
              ) : messages.length ? (
                <Messages
                  key={id}
                  messages={messages}
                  loading={!!state.loading[id]}
                  hasMore={!!view?.nextCursor}
                  more={() => void chat.loadHistory(id, true)}
                />
              ) : (
                <div className="empty-conversation">
                  <span className="welcome-mark" aria-hidden="true">
                    ✳
                  </span>
                  <h1>A fresh conversation.</h1>
                  <p>Write your first message below.</p>
                  <small>Empty conversations are temporary until the first accepted message.</small>
                </div>
              )}
              <div className="chat-bottom">
                <Waiting turn={turn} />
                {view?.syncState === "uncertain" && !turn && (
                  <p className="sync-notice" role="status">
                    Checking gateway state. Sending is paused.
                  </p>
                )}
                <Composer
                  key={id}
                  draft={state.drafts[id] ?? ""}
                  attachments={state.attachments[id] ?? []}
                  imageLoading={!!state.imageLoading[id]}
                  imageError={state.imageErrors[id] ?? ""}
                  attach={(files) => void chat.attach(id, files)}
                  remove={(imageId) => chat.removeImage(id, imageId)}
                  change={(text) => chat.draft(id, text)}
                  send={() => void chat.send()}
                  stop={() => void chat.cancel()}
                  blocked={
                    !state.ready ||
                    !!settingsState.current?.admission.locked ||
                    isBusy(turn?.phase) ||
                    active.length >= 3 ||
                    !!state.loading[id] ||
                    !view ||
                    view.syncState !== "ready" ||
                    !!state.errors[id]
                  }
                  canStop={!!turn?.runId && isBusy(turn.phase)}
                  stopping={turn?.phase === "stopping"}
                />
              </div>
            </>
          ) : (
            <div className="welcome">
              <div className="welcome-content">
                <span className="eyebrow">YOUR LOCAL WORKSPACE</span>
                <span className="welcome-mark" aria-hidden="true">
                  ✳
                </span>
                <h1>Start a conversation.</h1>
                <p>
                  Ask a question. Work through an idea.
                  <br />
                  Pick up where you left off.
                </p>
                <button
                  className="primary-button"
                  disabled={!state.ready || state.creating}
                  onClick={() => void create()}
                >
                  {state.creating ? "Creating…" : "New conversation"}
                  <span aria-hidden="true">↗</span>
                </button>
                <div className="welcome-caption">
                  OpenClaw agent <span aria-hidden="true">·</span>{" "}
                  {settingsState.current?.models.find(
                    (model) => model.id === settingsState.current?.chatModel,
                  )?.name ??
                    settingsState.current?.chatModel ??
                    "Kimi K2 Thinking"}
                </div>
              </div>
              <div className="welcome-footer">
                <span>ONE WORKSPACE. YOUR CONVERSATIONS.</span>
                <span>POWERED BY OPENCLAW</span>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
