import { useEffect, useRef } from "react";

import type { ComposerProps } from "../types.ts";

export function Composer({ draft, change, send, stop, blocked, canStop, stopping }: ComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const oversized = new TextEncoder().encode(draft).length > 8192;

  useEffect(() => {
    input.current?.focus();
  }, []);

  return (
    <div className="composer-area">
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label className="sr-only" htmlFor="message-input">
          Message OpenClaw
        </label>
        <textarea
          id="message-input"
          ref={input}
          value={draft}
          rows={2}
          placeholder="Message OpenClaw…"
          onChange={(event) => change(event.target.value)}
          aria-describedby="composer-help"
          aria-invalid={oversized}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!blocked && !oversized && draft.trim()) send();
            }
          }}
        />
        <div className="composer-toolbar">
          <span className="model-label">
            <span aria-hidden="true">◈</span> Kimi K2 Thinking
          </span>
          {canStop ? (
            <button type="button" className="stop-button" onClick={stop} disabled={stopping}>
              <span aria-hidden="true">■</span>
              {stopping ? "Stopping…" : "Stop"}
            </button>
          ) : (
            <button
              className="send-button"
              type="submit"
              disabled={blocked || oversized || !draft.trim()}
              aria-label="Send message"
            >
              ↑
            </button>
          )}
        </div>
      </form>
      <div className="composer-help" id="composer-help">
        <span>
          {oversized
            ? "Message exceeds the 8 KiB limit."
            : "Enter to send · Shift + Enter for a new line"}
        </span>
        <span>Responses can make mistakes.</span>
      </div>
    </div>
  );
}
