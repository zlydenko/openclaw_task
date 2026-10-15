import { ApiError } from "./errors.ts";
import { record } from "./validation.ts";
import type { ImageAttachment } from "./types.ts";

export const IMAGE_BYTES_LIMIT = 5 * 1024 * 1024;
export const MESSAGE_BODY_LIMIT = Math.ceil(IMAGE_BYTES_LIMIT / 3) * 4 + 16 * 1024;
export const IMAGE_COUNT_LIMIT = 4;

export function imageAttachments(value: unknown): ImageAttachment[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value))
    throw new ApiError(400, "INVALID_IMAGES", "Use an image attachment list.");
  if (value.length > IMAGE_COUNT_LIMIT)
    throw new ApiError(413, "IMAGE_LIMIT", "Attach at most 4 images, up to 5 MiB in total.");

  let total = 0;
  return value.map((item) => {
    const image = record(item);
    if (
      Object.keys(image).some(
        (key) => !["type", "mimeType", "fileName", "content"].includes(key),
      ) ||
      image.type !== "image" ||
      typeof image.mimeType !== "string" ||
      !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(image.mimeType) ||
      typeof image.fileName !== "string" ||
      !image.fileName.trim() ||
      image.fileName.length > 200 ||
      Array.from(image.fileName).some(
        (char) =>
          char === "/" || char === "\\" || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) ||
      typeof image.content !== "string" ||
      !image.content.length ||
      image.content.length % 4 !== 0 ||
      /[^A-Za-z0-9+/=]/.test(image.content)
    )
      throw new ApiError(
        400,
        "INVALID_IMAGES",
        "Attach PNG, JPEG, WebP, or GIF images with a filename and base64 content.",
      );

    const bytes = Buffer.from(image.content, "base64");
    total += bytes.length;
    if (total > IMAGE_BYTES_LIMIT)
      throw new ApiError(413, "IMAGE_LIMIT", "Images must not exceed 5 MiB in total.");
    if (bytes.toString("base64") !== image.content)
      throw new ApiError(400, "INVALID_IMAGES", "The image content is not valid base64.");

    const valid =
      image.mimeType === "image/png"
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : image.mimeType === "image/jpeg"
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : image.mimeType === "image/gif"
            ? ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
            : bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
              bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (!valid)
      throw new ApiError(400, "INVALID_IMAGES", "Image bytes do not match the selected format.");

    // OpenClaw performs full media detection and preparation through chat.send.
    return {
      type: "image",
      mimeType: image.mimeType,
      fileName: image.fileName,
      content: image.content,
    } as ImageAttachment;
  });
}
