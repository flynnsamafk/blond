/**
 * Swappable hair-segmentation boundary.
 *
 * Everything in the color lab gets its masks from THIS one function. The current
 * implementation is MediaPipe's selfie-multiclass segmenter (Apache-2.0) running
 * entirely in the browser. It is a BASELINE only — to swap in a stronger matting
 * model later (e.g. BiRefNet for cleaner hairline edges), replace the body of
 * `segmentHair` and keep the signature. Nothing else in the lab should import
 * `@mediapipe/*` directly.
 *
 * Privacy: the uploaded image never leaves the browser. MediaPipe fetches its
 * WASM runtime + model weights from a CDN once (static assets, then cached); the
 * segmentation itself runs locally on the GPU (CPU fallback).
 */

import type { ImageSegmenter as MPImageSegmenter } from "@mediapipe/tasks-vision";

// Pin the WASM bundle to the INSTALLED package version so the JS API and the
// WebAssembly stay in lockstep. Bump both together.
const TASKS_VISION_VERSION = "0.10.35";
const WASM_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;

// Google-hosted selfie-multiclass model. Per-pixel classes:
//   0 background · 1 hair · 2 body-skin · 3 face-skin · 4 clothes · 5 others
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";
const HAIR_CLASS = 1;
const BODY_SKIN_CLASS = 2;
const FACE_SKIN_CLASS = 3;

export type SegmentSource = HTMLCanvasElement | HTMLImageElement | ImageBitmap;

export interface HairSegmentation {
  /** RGBA mask: hair pixels are white with alpha = confidence (0..255); rest transparent. */
  maskCanvas: HTMLCanvasElement;
  /**
   * RGBA mask of SKIN (face + body), same encoding as `maskCanvas`. Used to find
   * the hairline — the hair↔skin boundary — which anchors the root-to-tip field.
   */
  skinCanvas: HTMLCanvasElement;
  /** Mask dimensions (match the source you passed in). */
  width: number;
  height: number;
}

let segmenterPromise: Promise<MPImageSegmenter> | null = null;

/** Lazily build (and cache) the segmenter. Dynamic import keeps MediaPipe out of SSR. */
async function getSegmenter(): Promise<MPImageSegmenter> {
  if (segmenterPromise) return segmenterPromise;
  segmenterPromise = (async () => {
    const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
    const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
    const make = (delegate: "GPU" | "CPU") =>
      ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "IMAGE",
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    try {
      return await make("GPU");
    } catch {
      // Some machines/headless GPUs reject the WebGL delegate — fall back to CPU.
      return await make("CPU");
    }
  })();
  return segmenterPromise;
}

/** Turn a per-pixel float field (0..1) into a white RGBA mask whose alpha = the value. */
function floatMaskToCanvas(w: number, h: number, valueAt: (i: number) => number): HTMLCanvasElement {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = Math.round(Math.min(1, Math.max(0, valueAt(i))) * 255);
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = a;
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D context for a mask canvas.");
  ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  return canvas;
}

/**
 * Segment hair (and skin) from an image. The ONLY segmentation entry point in the lab.
 *
 * Returns masks at the source resolution: hair = white, alpha = the model's
 * per-pixel confidence, so feathered/incorrect edges stay visible (important for
 * judging quality and for soft compositing later). The skin mask is the per-pixel
 * max of the face-skin and body-skin classes.
 */
export async function segmentHair(source: SegmentSource): Promise<HairSegmentation> {
  const segmenter = await getSegmenter();

  // Copy the confidence values OUT of MediaPipe's buffers inside the callback —
  // the result is only valid for the callback's lifetime.
  const masks = await new Promise<{
    hair: Float32Array;
    faceSkin: Float32Array;
    bodySkin: Float32Array;
    w: number;
    h: number;
  }>((resolve, reject) => {
    try {
      segmenter.segment(source, (result) => {
        const hair = result.confidenceMasks?.[HAIR_CLASS];
        const faceSkin = result.confidenceMasks?.[FACE_SKIN_CLASS];
        const bodySkin = result.confidenceMasks?.[BODY_SKIN_CLASS];
        if (!hair) {
          reject(new Error("Segmenter returned no hair mask."));
          return;
        }
        const w = hair.width;
        const h = hair.height;
        // Skin classes should always be present, but tolerate their absence by
        // falling back to a zero field (no skin → field seeds from topmost hair).
        const zeros = () => new Float32Array(w * h);
        resolve({
          hair: hair.getAsFloat32Array().slice(),
          faceSkin: faceSkin ? faceSkin.getAsFloat32Array().slice() : zeros(),
          bodySkin: bodySkin ? bodySkin.getAsFloat32Array().slice() : zeros(),
          w,
          h,
        });
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });

  const { hair, faceSkin, bodySkin, w, h } = masks;
  const maskCanvas = floatMaskToCanvas(w, h, (i) => hair[i]);
  const skinCanvas = floatMaskToCanvas(w, h, (i) => Math.max(faceSkin[i], bodySkin[i]));

  return { maskCanvas, skinCanvas, width: w, height: h };
}
