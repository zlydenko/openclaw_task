import { useState } from "react";

import type { ImagePreviewProps } from "../types.ts";

export function ImagePreview({ image }: ImagePreviewProps) {
  const [failed, setFailed] = useState(false);

  return (
    <figure>
      {image.url &&
        (failed ? (
          <div className="image-unavailable" role="status">
            <span>Preview unavailable.</span>
            <button
              type="button"
              className="text-button"
              onClick={() => setFailed(false)}
              aria-label={"Retry preview for " + image.fileName}
            >
              Retry
            </button>
          </div>
        ) : (
          <img
            src={image.url}
            alt={image.fileName}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ))}
      <figcaption>
        <span aria-hidden="true">▧ </span>
        {image.fileName}
      </figcaption>
    </figure>
  );
}
