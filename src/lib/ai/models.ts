/**
 * Registry of image models the tester can call.
 *
 * All of these are the "Nano Banana" image-to-image family: they take the
 * uploaded customer photo + reference hairstyle and edit them while preserving
 * the customer's identity. (Imagen was removed — it is text-to-image only and
 * cannot keep the customer's face.)
 *
 * Output resolution is requested via generationConfig.imageConfig.imageSize.
 * For our 3:4 portrait, "2K" (~1536x2048) comfortably exceeds 1080p; "1K"
 * (~1024px) is a bit short on the narrow edge.
 */

export type ImageSize = "1K" | "2K";

/** Which upstream API a model is served by. Decides how /api/try-on calls it. */
export type Provider = "google" | "xai";

export interface ImageModel {
  /** The model id as used in the REST URL. */
  id: string;
  /** Short name for the picker. */
  label: string;
  /** Upstream provider. Defaults to Google (Gemini) when omitted. */
  provider: Provider;
  /** Output resolutions this model supports, smallest first. */
  sizes: ImageSize[];
  /** Rough cost per image, USD, keyed by resolution. */
  cost: Partial<Record<ImageSize, number>>;
  /** One-line description shown under the picker. */
  note: string;
}

export const IMAGE_MODELS: ImageModel[] = [
  {
    id: "gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image (Nano Banana)",
    provider: "google",
    sizes: ["1K", "2K"],
    cost: { "1K": 0.067, "2K": 0.101 },
    note: "Fast image-to-image. Keeps the customer's face and supports 2K (1080p+).",
  },
  {
    id: "gemini-3-pro-image",
    label: "Gemini 3 Pro Image (Nano Banana 2)",
    provider: "google",
    sizes: ["1K", "2K"],
    cost: { "1K": 0.134, "2K": 0.134 },
    note: "Highest quality and best prompt-following. Slower and pricier; supports 2K.",
  },
  {
    id: "gemini-3-flash-lite-image",
    label: "Gemini 3 Flash-Lite Image (Nano Banana 2 Lite)",
    provider: "google",
    sizes: ["1K", "2K"],
    // Estimate — the fastest/cheapest of the Nano Banana 2 family. Confirm the
    // exact model id + price against the Gemini docs.
    cost: { "1K": 0.03, "2K": 0.05 },
    note: "Lightest Nano Banana 2 — fastest & cheapest. Model id/price are estimates; confirm in Gemini docs.",
  },
  {
    id: "gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image",
    provider: "google",
    sizes: ["1K"],
    cost: { "1K": 0.039 },
    note: "Cheapest, but caps at 1K (~1024px) — below true 1080p.",
  },
  {
    id: "grok-imagine-image-quality",
    label: "Grok Imagine Image (xAI)",
    provider: "xai",
    sizes: ["1K", "2K"],
    // xAI image pricing isn't published in the same per-image table; these are
    // rough placeholders so the cost readout isn't blank — confirm in the xAI
    // console and adjust.
    cost: { "1K": 0.02, "2K": 0.05 },
    note: "xAI Grok Imagine image-to-image (up to 3 source images). Needs XAI_API_KEY (console.x.ai). Cost shown is an estimate.",
  },
];

// Default to the Pro model at 1K: Pro reliably performs the cross-person hair
// transfer (Flash tends to passthrough), and 1K keeps generations fast (~15s)
// instead of the 90s+ that 2K can hit. Both are switchable in the UI.
export const DEFAULT_MODEL_ID = "gemini-3-pro-image";
export const DEFAULT_SIZE: ImageSize = "1K";

export function getModel(id: string): ImageModel | undefined {
  return IMAGE_MODELS.find((m) => m.id === id);
}

/** Clamp a requested size to one the model actually supports. */
export function resolveSize(model: ImageModel, requested: ImageSize): ImageSize {
  return model.sizes.includes(requested) ? requested : model.sizes[model.sizes.length - 1];
}

/** Cost per image for the given model at the (resolved) size. */
export function costFor(model: ImageModel, requested: ImageSize): number {
  return model.cost[resolveSize(model, requested)] ?? 0;
}

/**
 * Per-stage model + resolution tiers — the biggest credit saver.
 *
 * The pipeline has two generative stages plus an opt-in re-run:
 *   - base:     built ONCE per customer. Default 3.1 Flash · 1K for speed and
 *               reliability (Pro 503s too often to be the default; switch to it
 *               per-stage in the UI when you want its stronger transfer).
 *   - apply:    the REPEATED try-on (3.1 Flash · 1K).
 *   - finalize: re-run the chosen styled result (Pro). 1K by default; bump
 *               this to 2K if you want a true HD download. Phase 2; not in UI.
 *
 * Sizes here are *requested* — callers should still pass them through
 * resolveSize() so a model that lacks a size degrades gracefully.
 */
export type StageKind = "base" | "apply" | "finalize";

export interface StageConfig {
  modelId: string;
  size: ImageSize;
}

export const STAGE_CONFIG: Record<StageKind, StageConfig> = {
  base: { modelId: "gemini-3.1-flash-image", size: "1K" },
  apply: { modelId: "gemini-3.1-flash-image", size: "1K" },
  finalize: { modelId: "gemini-3-pro-image", size: "1K" },
};
