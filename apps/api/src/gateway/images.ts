import { ApiError } from "../errors.ts";
import { IMAGE_BYTES_LIMIT } from "../images.ts";
import type { ImageContent, StoredImage } from "../types.ts";
import { record, text } from "../validation.ts";

function inboundSource(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 1024) return;
  const match = /^media:\/\/inbound\/([^/?#]+)$/.exec(value);
  if (!match) return;
  try {
    const id = decodeURIComponent(match[1]!);
    if (
      id &&
      id !== "." &&
      id !== ".." &&
      !/[\\/]/.test(id) &&
      !id.includes(String.fromCharCode(0))
    )
      return value;
  } catch {
    /* Invalid media reference. */
  }
}

export function storedImages(value: unknown): StoredImage[] {
  const message = record(value);
  const facts = record(message.__openclaw).media;
  const saved = (Array.isArray(facts) ? facts : []).flatMap((item) => {
    const fact = record(item);
    return fact.kind === "image" || text(fact.contentType).startsWith("image/")
      ? [
          {
            fileName: text(fact.fileName).slice(0, 200) || "Attached image",
            source: inboundSource(fact.url),
          },
        ]
      : [];
  });
  if (saved.length) return saved.slice(0, 4);

  return (Array.isArray(message.content) ? message.content : [])
    .flatMap((item) => {
      const block = record(item);
      const attachment = record(block.attachment);
      if (block.type === "attachment" && attachment.kind === "image")
        return [
          {
            fileName: text(attachment.label).slice(0, 200) || "Attached image",
            source: inboundSource(attachment.url),
          },
        ];
      if (["image", "input_image", "image_url"].includes(text(block.type)))
        return [
          {
            fileName: text(block.fileName).slice(0, 200) || "Attached image",
            source: inboundSource(block.url ?? record(block.source).url ?? block.image_url),
          },
        ];
      return [];
    })
    .slice(0, 4);
}

export async function readGatewayImage(
  base: URL,
  token: string,
  sessionKey: string,
  source: string,
): Promise<ImageContent> {
  if (!inboundSource(source)) throw new ApiError(404, "IMAGE_NOT_FOUND", "Image not found.");

  // This is OpenClaw's authenticated route for retained inbound uploads.
  const url = new URL("/__openclaw__/assistant-media", base);
  url.searchParams.set("source", source);
  url.searchParams.set("sessionKey", sessionKey);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(503, "IMAGE_UNAVAILABLE", "The image could not be loaded.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError(
      response.status === 404 ? 404 : 503,
      "IMAGE_UNAVAILABLE",
      "The image could not be loaded.",
    );
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "";
  if (
    !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mimeType) ||
    !response.body
  ) {
    await response.body?.cancel();
    throw new ApiError(404, "IMAGE_NOT_FOUND", "Image not found.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    if (Number(response.headers.get("content-length")) > IMAGE_BYTES_LIMIT)
      throw new ApiError(413, "IMAGE_LIMIT", "The image exceeds the display limit.");
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > IMAGE_BYTES_LIMIT)
        throw new ApiError(413, "IMAGE_LIMIT", "The image exceeds the display limit.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "IMAGE_UNAVAILABLE", "The image could not be loaded.");
  } finally {
    reader.releaseLock();
  }
  return { bytes: Uint8Array.from(Buffer.concat(chunks)), mimeType };
}
