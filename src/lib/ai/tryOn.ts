/**
 * Client helper for the hairstyle tester. Downscales images in the browser for
 * faster/cheaper requests, then POSTs an ordered set of images + a prompt to
 * /api/try-on, which forwards them to Gemini.
 *
 * The route is generic: the caller decides what each image means and describes
 * it in the prompt as "Image 1", "Image 2", … The two pipeline stages are:
 *   - Build base profile:  images = [frontPhoto, sidePhoto]
 *   - Apply a hairstyle:   images = [baseHeadshot, hairReference]
 */

import type { ImageSize } from "@/lib/ai/models";

export interface GenerateImageInput {
  /** Model id from src/lib/ai/models.ts. */
  modelId: string;
  /** Requested output resolution. */
  size: ImageSize;
  /** The complete instruction sent to the model. */
  prompt: string;
  /** Ordered images; referenced as Image 1..N in the prompt, in this order. */
  images: Blob[];
}

/**
 * Downscale large images in the browser (respects EXIF orientation). Keeps the
 * input within sane request-body limits without starving the 2K output.
 */
async function downscale(blob: Blob, maxDim = 1536): Promise<Blob> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return blob;
  }
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) {
      bitmap.close();
      return blob;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return blob;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob>((resolve) =>
      canvas.toBlob((out) => resolve(out ?? blob), "image/jpeg", 0.9),
    );
  } catch {
    return blob;
  }
}

/**
 * Generate an image from an ordered set of images + a prompt. Returns a data URL
 * for the result, or throws with the server's error message.
 */
export async function generateImage({
  modelId,
  size,
  prompt,
  images,
}: GenerateImageInput): Promise<string> {
  const scaled = await Promise.all(images.map((b) => downscale(b)));

  const form = new FormData();
  form.append("model", modelId);
  form.append("size", size);
  form.append("prompt", prompt);
  scaled.forEach((b, i) => form.append("image", b, `image-${i}.jpg`));

  // Abort a hung request instead of spinning forever. The server self-aborts the
  // upstream model call at 140s, so 150s here lets the server's clean error win.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 150_000);

  let res: Response;
  try {
    res = await fetch("/api/try-on", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        "Generation timed out after 150s. Try again, or switch to a faster model / 1K resolution.",
      );
    }
    throw new Error("Network error — couldn't reach the server. Check your connection and retry.");
  } finally {
    clearTimeout(timeout);
  }

  const data = (await res.json().catch(() => null)) as
    | { imageUrl?: string; error?: string }
    | null;

  if (!res.ok || !data?.imageUrl) {
    throw new Error(data?.error ?? `Generation failed (${res.status}).`);
  }
  return data.imageUrl;
}
