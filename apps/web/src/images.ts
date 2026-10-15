import type { ImageAttachment } from "./types.ts";

export const IMAGE_BYTES_LIMIT = 5 * 1024 * 1024;
export const IMAGE_COUNT_LIMIT = 4;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const imageUrl = (image: ImageAttachment) =>
  "data:" + image.mimeType + ";base64," + image.content;

export async function readImages(files: File[], existing: ImageAttachment[]) {
  if (existing.length + files.length > IMAGE_COUNT_LIMIT)
    throw new Error("Attach at most 4 images.");
  const existingBytes = existing.reduce((total, image) => total + atob(image.content).length, 0);
  if (existingBytes + files.reduce((total, file) => total + file.size, 0) > IMAGE_BYTES_LIMIT)
    throw new Error("Images must not exceed 5 MiB in total.");
  if (files.some((file) => !IMAGE_TYPES.includes(file.type) || !file.size))
    throw new Error("Choose a non-empty PNG, JPEG, WebP, or GIF image.");

  const images = await Promise.all(
    files.map(
      (file) =>
        new Promise<ImageAttachment>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("The image could not be read. Select it again."));
          reader.onabort = reader.onerror;
          reader.onload = () => {
            const value = String(reader.result);
            resolve({
              id: crypto.randomUUID(),
              type: "image",
              fileName: file.name,
              mimeType: file.type,
              content: value.slice(value.indexOf(",") + 1),
            });
          };
          reader.readAsDataURL(file);
        }),
    ),
  );
  return images;
}
