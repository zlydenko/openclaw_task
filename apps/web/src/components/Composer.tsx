import { useEffect, useRef } from "react";

import { imageUrl, IMAGE_TYPES } from "../images.ts";
import type { ComposerProps } from "../types.ts";

export function Composer({
  draft,
  attachments,
  imageLoading,
  imageError,
  attach,
  remove,
  change,
  send,
  stop,
  blocked,
  canStop,
  stopping,
}: ComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const oversized = new TextEncoder().encode(draft).length > 8192;
  const canSend =
    !blocked && !oversized && !imageLoading && (!!draft.trim() || !!attachments.length);

  useEffect(() => {
    input.current?.focus();
  }, []);

  return (
    <div className="composer-area">
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) send();
        }}
      >
        {!!attachments.length && (
          <div className="image-previews" aria-label="Attached images">
            {attachments.map((image) => (
              <div className="image-preview" key={image.id}>
                <img src={imageUrl(image)} alt={image.fileName} />
                <span title={image.fileName}>{image.fileName}</span>
                <button
                  type="button"
                  className="remove-image"
                  aria-label={"Remove " + image.fileName}
                  disabled={imageLoading}
                  onClick={() => remove(image.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
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
          aria-describedby="composer-help image-help"
          aria-invalid={oversized}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files).filter((file) =>
              file.type.startsWith("image/"),
            );
            if (files.length) {
              event.preventDefault();
              attach(files);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canSend) send();
            }
          }}
        />
        <input
          ref={picker}
          type="file"
          className="sr-only"
          tabIndex={-1}
          accept={IMAGE_TYPES.join(",")}
          multiple
          aria-label="Choose images"
          onChange={(event) => {
            attach(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-tools">
            <button
              type="button"
              className="attach-button"
              disabled={imageLoading}
              onClick={() => picker.current?.click()}
            >
              {imageLoading ? "Reading…" : "+ Images"}
            </button>
            <span className="model-label">
              <span aria-hidden="true">◈</span> Kimi K2 Thinking
            </span>
          </div>
          {canStop ? (
            <button type="button" className="stop-button" onClick={stop} disabled={stopping}>
              <span aria-hidden="true">■</span>
              {stopping ? "Stopping…" : "Stop"}
            </button>
          ) : (
            <button
              className="send-button"
              type="submit"
              disabled={!canSend}
              aria-label="Send message"
            >
              ↑
            </button>
          )}
        </div>
        <p className="image-help" id="image-help">
          PNG, JPEG, WebP, GIF · Up to 4 images, 5 MiB total · Paste images here
        </p>
        {imageError && (
          <p className="content-note" role="alert">
            {imageError}
          </p>
        )}
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
