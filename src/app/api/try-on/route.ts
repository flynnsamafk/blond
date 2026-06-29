import { NextResponse } from "next/server";

import {
  DEFAULT_MODEL_ID,
  DEFAULT_SIZE,
  getModel,
  resolveSize,
  type ImageSize,
} from "@/lib/ai/models";

// Image generation can take 10-90s+ and needs Node APIs (Buffer), so force the
// Node.js runtime and a long timeout. NOTE: hosting plans cap maxDuration —
// Vercel Hobby = 60s, Pro = 300s. The route also self-aborts the upstream call
// at 140s (below) so a stalled model never hangs the request.
export const runtime = "nodejs";
export const maxDuration = 300;

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const XAI_BASE = "https://api.x.ai/v1";

interface InlinePart {
  inlineData: { mimeType: string; data: string };
}
type Part = { text: string } | InlinePart;

async function blobToInlinePart(blob: Blob): Promise<InlinePart> {
  const buf = Buffer.from(await blob.arrayBuffer());
  return {
    inlineData: { mimeType: blob.type || "image/jpeg", data: buf.toString("base64") },
  };
}

/** Encode a blob as a `data:` URL — xAI's image API takes images as image_url objects. */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = Buffer.from(await blob.arrayBuffer());
  return `data:${blob.type || "image/jpeg"};base64,${buf.toString("base64")}`;
}

/**
 * Grok Imagine (xAI) image-to-image. Mirrors the Gemini path's contract: takes
 * the same ordered images + prompt and returns `{ imageUrl }`. xAI's edits
 * endpoint is JSON and accepts up to 3 source images as image_url objects; the
 * prompt refers to them as Image 1, Image 2, … in the order sent.
 */
async function runXaiEdit(
  modelId: string,
  prompt: string,
  images: File[],
  size: ImageSize,
): Promise<NextResponse> {
  const apiKey = process.env.XAI_API_KEY ?? process.env.GROK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Grok is not configured. Add XAI_API_KEY to .env.local (get a key at https://console.x.ai) and restart the dev server.",
        code: "NO_API_KEY",
      },
      { status: 501 },
    );
  }

  // xAI's edits endpoint wants `image` as an ARRAY OF STRINGS (data: URLs are
  // accepted). It rejects bare strings and arrays of objects — verified against
  // the live API. Order is preserved, so the prompt's "Image 1/2" still line up.
  const imageUrls = await Promise.all(images.map(blobToDataUrl));

  const body = JSON.stringify({
    model: modelId,
    prompt,
    image: imageUrls,
    // Pin the output canvas to match the Gemini path's 3:4. Without this Grok
    // picks its own (taller) canvas, which is the main reason the turnaround
    // sheet comes out mis-framed. resolution mirrors the UI's 1K/2K choice.
    aspect_ratio: "3:4",
    resolution: size === "2K" ? "2k" : "1k",
    response_format: "b64_json",
    n: 1,
  });

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), TOTAL_BUDGET_MS);
  let res: Response;
  try {
    res = await fetch(`${XAI_BASE}/images/edits`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json(
        { error: "Grok took too long (over 140s) and was stopped. Try again." },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Network error calling Grok." },
      { status: 502 },
    );
  } finally {
    clearTimeout(abortTimer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const overloaded = res.status === 429 || res.status === 503;
    return NextResponse.json(
      {
        error: overloaded
          ? `Grok is busy (${res.status}). Wait a moment and retry. ${detail.slice(0, 300)}`
          : `Grok request failed (${res.status}). ${detail.slice(0, 500)}`,
      },
      { status: 502 },
    );
  }

  const data = (await res.json().catch(() => null)) as {
    data?: { b64_json?: string; url?: string; mime_type?: string }[];
  } | null;
  const item = data?.data?.[0];
  if (item?.b64_json) {
    const mime = item.mime_type || "image/jpeg";
    return NextResponse.json({ imageUrl: `data:${mime};base64,${item.b64_json}` });
  }
  if (typeof item?.url === "string") {
    return NextResponse.json({ imageUrl: item.url });
  }
  return NextResponse.json({ error: "Grok did not return an image." }, { status: 502 });
}

// --- Transient-failure resilience ----------------------------------------
// Google returns 503 ("high demand") / 429 (rate limit) / 5xx when a model is
// momentarily overloaded. These almost always clear within seconds, so we ride
// them out with a few backed-off retries instead of failing the whole request.
// NOTE: this only smooths brief spikes — a sustained, multi-tenant capacity
// problem needs the paid tier / Vertex, not more retries.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4; // 1 initial + 3 retries
// Whole-request budget, kept under the client's 150s abort so OUR clean error
// surfaces rather than the client's generic timeout.
const TOTAL_BUDGET_MS = 140_000;
// Don't start a fresh attempt without at least this much budget left.
const MIN_ATTEMPT_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Backoff before the next retry: honour Retry-After, else exponential+jitter. */
function backoffMs(attempt: number, retryAfter: string | null): number {
  const ra = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(ra) && ra >= 0) return Math.min(ra * 1000, 8_000);
  const base = Math.min(1_000 * 2 ** (attempt - 1), 8_000); // ~1s, 2s, 4s, cap 8s
  return base + Math.random() * base * 0.5; // + up to 50% jitter
}

/**
 * Generic image endpoint for the hairstyle tester.
 *
 * The route is deliberately dumb: it forwards an ORDERED list of images plus a
 * prompt to Gemini and returns the generated image. The meaning of each image
 * (identity photo vs. hairstyle reference vs. a finished base headshot) lives
 * entirely in the prompt text, which refers to them as "Image 1", "Image 2", …
 * So the same endpoint serves both pipeline stages:
 *   - Build base profile:  images = [front, side]
 *   - Apply a hairstyle:   images = [baseHeadshot, hairReference]
 *
 * Body (multipart form data):
 *   - model:  model id (see src/lib/ai/models.ts). Defaults to the Pro model.
 *   - size:   "1K" | "2K" output resolution.
 *   - prompt: required full instruction text.
 *   - image:  one or more image parts, REPEATED in order (Image 1, Image 2, …).
 *
 * Returns `{ imageUrl: <data URL> }` or `{ error }`.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const prompt = (form.get("prompt") as string | null)?.trim();
  const modelId = (form.get("model") as string | null)?.trim() || DEFAULT_MODEL_ID;
  const sizeRaw = (form.get("size") as string | null)?.trim();
  const images = form.getAll("image").filter((v): v is File => v instanceof Blob && v.size > 0);

  const model = getModel(modelId);
  if (!model) {
    return NextResponse.json({ error: `Unknown model '${modelId}'.` }, { status: 400 });
  }
  if (!prompt) {
    return NextResponse.json({ error: "Missing 'prompt' text." }, { status: 400 });
  }
  if (images.length === 0) {
    return NextResponse.json(
      { error: "Provide at least one image. Re-pick your photos and try again." },
      { status: 400 },
    );
  }

  const size: ImageSize = resolveSize(model, (sizeRaw as ImageSize) || DEFAULT_SIZE);

  // Route to the right provider. Grok (xAI) has its own endpoint, key and body
  // shape; everything below this point is the Google/Gemini path.
  if (model.provider === "xai") {
    return runXaiEdit(modelId, prompt, images, size);
  }

  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "AI is not configured. Add GEMINI_API_KEY to .env.local (free key: https://aistudio.google.com/apikey) and restart the dev server.",
        code: "NO_API_KEY",
      },
      { status: 501 },
    );
  }

  // Image order matters: the prompt refers to these as Image 1, Image 2, … in
  // the exact order they are appended here.
  const parts: Part[] = [
    { text: prompt },
    ...(await Promise.all(images.map(blobToInlinePart))),
  ];

  const requestBody = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: "3:4", imageSize: size },
    },
  });

  // Retry transient overload/rate-limit errors with backoff, all inside a single
  // ~140s budget. Each attempt self-aborts on the remaining budget so a stalled
  // upstream call can't hang past the client's 150s timeout.
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let apiRes: Response | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) break;

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), remaining);

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/${modelId}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: requestBody,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(abortTimer);
      // Our own abort firing means the budget is spent — stop and report timeout.
      if (err instanceof Error && err.name === "AbortError") {
        return NextResponse.json(
          {
            error:
              "The model took too long (over 140s) and was stopped. Try 1K resolution or a faster model.",
          },
          { status: 504 },
        );
      }
      // Network blip — retry while budget allows, otherwise report it.
      const budgetLeft = deadline - Date.now() - MIN_ATTEMPT_MS;
      if (attempt < MAX_ATTEMPTS && budgetLeft > 0) {
        console.warn(`try-on: network error on attempt ${attempt}, retrying`);
        await sleep(Math.min(backoffMs(attempt, null), budgetLeft));
        continue;
      }
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Network error calling the model." },
        { status: 502 },
      );
    } finally {
      clearTimeout(abortTimer);
    }

    // Transient upstream status — back off and retry while there's budget.
    if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
      const budgetLeft = deadline - Date.now() - MIN_ATTEMPT_MS;
      if (budgetLeft <= 0) {
        apiRes = res; // no time to retry; surface this response below
        break;
      }
      const wait = Math.min(backoffMs(attempt, res.headers.get("retry-after")), budgetLeft);
      console.warn(
        `try-on: ${res.status} from ${modelId} (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${Math.round(wait)}ms`,
      );
      await res.text().catch(() => ""); // drain the body so the socket frees up
      await sleep(wait);
      continue;
    }

    apiRes = res;
    break;
  }

  // Ran out of budget while everything was still erroring transiently.
  if (!apiRes) {
    return NextResponse.json(
      {
        error:
          "The model is busy right now (repeated 503/timeouts) and didn't recover within the retry window. This is on the provider's side — wait a minute and try again, or switch to a faster model.",
      },
      { status: 503 },
    );
  }

  if (!apiRes.ok) {
    const detail = await apiRes.text().catch(() => "");
    const overloaded = apiRes.status === 503 || apiRes.status === 429;
    return NextResponse.json(
      {
        error: overloaded
          ? `The model is overloaded (${apiRes.status}) and didn't recover after ${MAX_ATTEMPTS} tries. This is on the provider's side — wait a minute and retry, or switch to a faster model. ${detail.slice(0, 300)}`
          : `Model request failed (${apiRes.status}). ${detail.slice(0, 500)}`,
      },
      { status: 502 },
    );
  }

  const data = await apiRes.json();
  const outParts: unknown[] = data?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = outParts.find(
    (p): p is InlinePart =>
      typeof p === "object" &&
      p !== null &&
      "inlineData" in p &&
      typeof (p as InlinePart).inlineData?.data === "string",
  );

  if (!imagePart) {
    const textPart = outParts.find(
      (p): p is { text: string } =>
        typeof p === "object" &&
        p !== null &&
        "text" in p &&
        typeof (p as { text: unknown }).text === "string",
    );
    const blockReason = data?.promptFeedback?.blockReason;
    const finishReason = data?.candidates?.[0]?.finishReason;
    return NextResponse.json(
      {
        error:
          textPart?.text ||
          (blockReason
            ? `The model declined this request (${blockReason}). Try clearer, well-lit photos.`
            : finishReason && finishReason !== "STOP"
              ? `The model returned no image (finishReason: ${finishReason}). Try different photos or a different prompt.`
              : "The model did not return an image. Try different photos or prompt."),
      },
      { status: 502 },
    );
  }

  const mimeType = imagePart.inlineData.mimeType ?? "image/png";
  return NextResponse.json({
    imageUrl: `data:${mimeType};base64,${imagePart.inlineData.data}`,
  });
}
