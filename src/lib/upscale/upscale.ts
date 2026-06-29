/**
 * Swappable image-upscaling boundary.
 *
 * Everything in the upscale lab gets its super-resolution from THIS one function.
 * The current implementation is UpscalerJS running a Real-ESRGAN model
 * (MIT-licensed) entirely in the browser on TensorFlow.js. It is a BASELINE for
 * judging quality — to swap engines later (a different ESRGAN variant, an ONNX /
 * WebGPU model, or a server-side `ncnn-vulkan` worker), replace the body of
 * `upscaleImage` and keep the signature. Nothing else in the lab imports
 * `upscaler` / `@tensorflow/tfjs` directly.
 *
 * Privacy: the uploaded image never leaves the browser. UpscalerJS fetches the
 * model weights from a CDN once (static assets, then cached); the upscaling runs
 * locally on the GPU via the TF.js WebGL backend (CPU fallback). Same posture as
 * the MediaPipe segmenter.
 */

export type UpscaleSource = HTMLCanvasElement | HTMLImageElement;

export interface UpscaleResult {
  /** The upscaled image as a canvas (scale × the input dimensions). */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Wall-clock time the upscale took, in milliseconds (excludes model download). */
  ms: number;
  /** Active TF.js backend — "webgl" (GPU) or "cpu". Tells you why it was fast/slow. */
  backend: string;
}

export interface UpscaleOptions {
  /** Progress 0..1, fired per tile so the UI can show a bar. */
  onProgress?: (rate: number) => void;
}

/** Fixed 2× for this test — the realistic "1K → 2K for free" case. */
export const UPSCALE_SCALE = 2;

// Lazily build (and cache) the engine. Dynamic import keeps TF.js out of SSR and
// out of every other route's bundle.
async function loadEngine() {
  const tf = await import("@tensorflow/tfjs");
  await tf.ready(); // ensure a backend (webgl, else cpu) is selected
  const { default: Upscaler } = await import("upscaler");
  const { default: x2 } = await import("@upscalerjs/esrgan-thick/2x");
  const upscaler = new Upscaler({ model: x2 });
  return { upscaler, backend: tf.getBackend() };
}

let enginePromise: ReturnType<typeof loadEngine> | null = null;
function getEngine() {
  if (!enginePromise) enginePromise = loadEngine();
  return enginePromise;
}

/** Draw any accepted source onto a fresh canvas (UpscalerJS wants pixels in hand). */
function toCanvas(source: UpscaleSource): HTMLCanvasElement {
  if (source instanceof HTMLCanvasElement) return source;
  const canvas = document.createElement("canvas");
  canvas.width = source.naturalWidth || source.width;
  canvas.height = source.naturalHeight || source.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D context for the source canvas.");
  ctx.drawImage(source, 0, 0);
  return canvas;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode the upscaled image."));
    img.src = url;
  });
}

/**
 * Upscale an image 2× with Real-ESRGAN. The ONLY upscaling entry point in the lab.
 *
 * Tiles the image internally (patchSize) so memory stays bounded on large inputs —
 * important for reliability across the device fleet.
 */
export async function upscaleImage(
  source: UpscaleSource,
  opts: UpscaleOptions = {},
): Promise<UpscaleResult> {
  const { upscaler, backend } = await getEngine();

  const srcCanvas = toCanvas(source);
  const dataUrl = srcCanvas.toDataURL("image/png");

  const start = performance.now();
  const out = await upscaler.upscale(dataUrl, {
    output: "base64",
    patchSize: 128, // tile so big images don't OOM the GPU
    padding: 6, // overlap to hide seams between tiles
    progress: (rate: number) => opts.onProgress?.(rate),
  });
  const ms = performance.now() - start;

  // Browser base64 output is a full data URL; guard in case that ever changes.
  const url = out.startsWith("data:") ? out : `data:image/png;base64,${out}`;
  const img = await loadImage(url);

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D context for the upscaled canvas.");
  ctx.drawImage(img, 0, 0);

  return { canvas, width: canvas.width, height: canvas.height, ms, backend };
}
