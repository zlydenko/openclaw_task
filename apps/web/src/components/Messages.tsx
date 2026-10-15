import { useEffect, useRef, useState } from "react";

import { Activity } from "./Activity.tsx";
import type { MessagesProps } from "../types.ts";

export function Messages({ messages, loading, hasMore, more }: MessagesProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const beforePage = useRef<number | null>(null);
  const [away, setAway] = useState(false);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;

    if (beforePage.current !== null && !loading) {
      element.scrollTop += element.scrollHeight - beforePage.current;
      beforePage.current = null;
    } else if (follow.current) element.scrollTop = element.scrollHeight;
  }, [messages, loading]);

  return (
    <div className="message-region">
      <div
        className="message-scroller"
        ref={scroller}
        onScroll={() => {
          const element = scroller.current!;
          follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
          setAway(!follow.current);
        }}
        aria-label="Messages"
        tabIndex={0}
      >
        <div className="message-column">
          {hasMore && (
            <button
              className="text-button history-more"
              disabled={loading}
              onClick={() => {
                beforePage.current = scroller.current!.scrollHeight;
                follow.current = false;
                more();
              }}
            >
              Load earlier messages
            </button>
          )}
          {messages.map((message) => (
            <article className={`message message-${message.role}`} key={message.id}>
              <div className="message-heading">
                <span className="message-avatar" aria-hidden="true">
                  {message.role === "user" ? "↗" : "✳"}
                </span>
                <span>{message.role === "user" ? "You" : "OpenClaw"}</span>
                {message.pending && <small>Pending</small>}
                {message.rejected && <small>Not sent</small>}
              </div>
              {message.text && <div className="message-text">{message.text}</div>}
              {!!message.images?.length && (
                <div className="message-images">
                  {message.images.map((image, index) => (
                    <figure key={index}>
                      {image.url && <img src={image.url} alt={image.fileName} loading="lazy" />}
                      <figcaption>
                        <span aria-hidden="true">▧ </span>
                        {image.fileName}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              {!!message.activities?.length && <Activity activities={message.activities} />}
              {message.unsupported && (
                <p className="content-note">Some content cannot be displayed in this chat.</p>
              )}
              {message.truncated && (
                <p className="content-note">This message is shortened by the display limit.</p>
              )}
            </article>
          ))}
        </div>
      </div>
      {away && (
        <button
          className="jump-button"
          onClick={() => {
            follow.current = true;
            scroller.current!.scrollTop = scroller.current!.scrollHeight;
            setAway(false);
          }}
        >
          Jump to latest ↓
        </button>
      )}
    </div>
  );
}
