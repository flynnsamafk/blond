"use client";

/**
 * COLOR LAB — isolated dev page for the hair color-profile feature.
 *
 * This page is a sandbox: it does NOT touch the working tester, /api/try-on,
 * models, history or prompts, and it makes NO Gemini/network calls. A user
 * uploads an image; everything is processed locally in the browser.
 *
 * Phase 1 — segmentation sanity check: upload/drop a portrait, run the swappable
 * `segmentHair()` (MediaPipe baseline) and view the detected hair region as a
 * semi-transparent overlay or as a mask-only image, so mask quality is judgeable.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { computeRootField, type RootField } from "@/lib/color/field";
import { segmentHair } from "@/lib/color/segment";

// Downscale the source before segmenting — keeps it fast and memory-light while
// staying well above the model's 256px working resolution.
const MAX_DIM = 1024;

// Overlay tint for the hair region — a saturated colour that reads clearly on
// most hair so edge errors are obvious.
const OVERLAY_COLOR = "#34d399"; // emerald

type View = "overlay" | "mask" | "field";

type Status =
  | { kind: "idle" }
  | { kind: "working"; note: string }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export default function ColorLabPage() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [view, setView] = useState<View>("overlay");
  const [dragOver, setDragOver] = useState(false);
  const [stats, setStats] = useState<{ w: number; h: number; coverage: number } | null>(null);

  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const fieldRef = useRef<HTMLCanvasElement | null>(null); // root→tip heatmap
  const rootFieldRef = useRef<RootField | null>(null); // raw field (kept for later phases)
  const displayRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** Composite the current view (source + mask) into the on-screen canvas. */
  const render = useCallback(() => {
    const display = displayRef.current;
    const source = sourceRef.current;
    const mask = maskRef.current;
    if (!display || !source || !mask) return;

    display.width = source.width;
    display.height = source.height;
    const ctx = display.getContext("2d");
    if (!ctx) return;
    // The context is reused across renders — reset blend state each pass.
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, display.width, display.height);

    if (view === "mask") {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, display.width, display.height);
      ctx.drawImage(mask, 0, 0);
      return;
    }

    if (view === "field") {
      // Source underneath (so you can see where the field sits on the photo),
      // then the root→tip heatmap on top. The heatmap is transparent outside the
      // hair region, so the rest of the photo shows through.
      ctx.drawImage(source, 0, 0);
      const heat = fieldRef.current;
      if (heat) {
        ctx.globalAlpha = 0.85;
        ctx.drawImage(heat, 0, 0);
        ctx.globalAlpha = 1;
      }
      return;
    }

    // Overlay: a luminance-preserving PREVIEW of recolor (not yet the real
    // shader). Build the tint clipped to the hair region (the mask's soft alpha
    // gives soft edges), then blend with "color" — which keeps the photo's
    // LUMINANCE (shading/highlights) and swaps only HUE+SATURATION. That's the
    // same hue/sat swap Phase 3 will do properly in WebGL, so the tint reads like
    // dye with depth instead of flat paint.
    ctx.drawImage(source, 0, 0);
    const tint = document.createElement("canvas");
    tint.width = mask.width;
    tint.height = mask.height;
    const tctx = tint.getContext("2d");
    if (tctx) {
      tctx.fillStyle = OVERLAY_COLOR;
      tctx.fillRect(0, 0, tint.width, tint.height);
      // Keep colour only where the mask has alpha → a hair-shaped tint layer.
      tctx.globalCompositeOperation = "destination-in";
      tctx.drawImage(mask, 0, 0);
    }
    ctx.globalCompositeOperation = "color"; // keep luminance, swap hue+sat
    ctx.drawImage(tint, 0, 0);
    ctx.globalCompositeOperation = "source-over"; // reset for the next pass
  }, [view]);

  // Redraw whenever the view toggles (and on mount, once refs exist).
  useEffect(() => {
    render();
  }, [render]);

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file || !file.type.startsWith("image/")) return;
      setStatus({ kind: "working", note: "Preparing image…" });
      setStats(null);
      try {
        // Decode (respect EXIF) and downscale into the source canvas.
        let bitmap: ImageBitmap;
        try {
          bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        } catch {
          bitmap = await createImageBitmap(file);
        }
        const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const source = document.createElement("canvas");
        source.width = w;
        source.height = h;
        const sctx = source.getContext("2d");
        if (!sctx) throw new Error("Could not get a 2D context.");
        sctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close();
        sourceRef.current = source;

        setStatus({
          kind: "working",
          note: "Loading model & detecting hair… (first run downloads the model)",
        });
        const { maskCanvas, skinCanvas, width, height } = await segmentHair(source);
        maskRef.current = maskCanvas;

        // Read both masks' pixels once: hair drives coverage + the field; skin
        // locates the hairline that anchors the field's root.
        const mctx = maskCanvas.getContext("2d");
        const skctx = skinCanvas.getContext("2d");
        if (!mctx || !skctx) throw new Error("Could not read the segmentation masks.");
        const hairData = mctx.getImageData(0, 0, width, height);
        const skinData = skctx.getImageData(0, 0, width, height);

        // Hair coverage = share of pixels above 50% confidence — a quick read on
        // whether the mask is plausible (too low = missed hair, too high = bleed).
        const total = width * height;
        let hairPx = 0;
        for (let i = 0; i < total; i++) if (hairData.data[i * 4 + 3] > 128) hairPx++;
        const coverage = total ? hairPx / total : 0;

        // Yield a frame so "Computing root→tip field…" paints before the
        // CPU-bound distance transform briefly blocks the main thread.
        setStatus({ kind: "working", note: "Computing root→tip field…" });
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const rootField = computeRootField({
          width,
          height,
          hair: hairData.data,
          skin: skinData.data,
        });
        rootFieldRef.current = rootField;
        fieldRef.current = buildFieldHeatmap(rootField);

        setStats({ w, h, coverage });
        setStatus({ kind: "ready" });
        requestAnimationFrame(render); // refs are set now — draw immediately
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "Something went wrong.",
        });
      }
    },
    [render],
  );

  const ready = status.kind === "ready";
  const working = status.kind === "working";

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
          Color Lab · isolated sandbox
        </p>
        <h1 className="text-xl font-semibold tracking-tight">Phase 2 — Root-to-tip field</h1>
        <p className="max-w-prose text-sm text-neutral-500">
          Upload a portrait. We detect hair with the swappable{" "}
          <code className="rounded bg-neutral-100 px-1">segmentHair()</code> boundary (MediaPipe
          baseline), then compute a geodesic <strong>root → tip</strong> field through the hair —
          the coordinate every color profile will paint along. Switch to <em>Root field</em> to
          inspect it: <span className="font-medium text-blue-600">blue ≈ root</span> →{" "}
          <span className="font-medium text-red-600">red ≈ tips</span>, following hair even when it
          curves over a shoulder. No Gemini calls; your image stays in the browser.
        </p>
      </header>

      {/* Upload / drop zone */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFile(e.dataTransfer.files?.[0]);
        }}
        className={`flex w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-6 text-center transition-colors ${
          dragOver ? "border-neutral-500 bg-neutral-100" : "border-neutral-300 bg-neutral-50 hover:border-neutral-400"
        }`}
      >
        <span className="text-sm font-medium text-neutral-700">
          {ready ? "Drop another portrait, or click to browse" : "Drop a portrait here, or click to browse"}
        </span>
        <span className="text-xs text-neutral-400">PNG or JPG · processed locally · downscaled to {MAX_DIM}px</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={view}
          onChange={setView}
          disabled={!ready}
          options={[
            { v: "overlay", label: "Overlay" },
            { v: "mask", label: "Mask only" },
            { v: "field", label: "Root field" },
          ]}
        />
        {stats && (
          <p className="text-xs text-neutral-500">
            {stats.w}×{stats.h}px · hair coverage{" "}
            <span className="font-medium text-neutral-700">{(stats.coverage * 100).toFixed(1)}%</span>
          </p>
        )}
      </div>

      {/* Root-field legend */}
      {view === "field" && ready && (
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span className="font-medium text-neutral-700">Root</span>
          <span
            className="h-2 flex-1 rounded"
            style={{
              background:
                "linear-gradient(to right, hsl(240 100% 50%), hsl(180 100% 50%), hsl(120 100% 50%), hsl(60 100% 50%), hsl(0 100% 50%))",
            }}
          />
          <span className="font-medium text-neutral-700">Tips</span>
        </div>
      )}

      {/* Preview */}
      <div className="relative overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
        <canvas ref={displayRef} className="block h-auto w-full" />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            {status.kind === "error" ? (
              <p className="max-w-sm text-sm text-red-400">{status.message}</p>
            ) : working ? (
              <p className="text-sm text-neutral-300">{status.note}</p>
            ) : (
              <p className="text-sm text-neutral-500">
                No image yet — upload one to see the hair mask and root→tip field.
              </p>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-neutral-400">
        Isolated test page at <code className="rounded bg-neutral-100 px-1">/lab/color</code>. Segmentation
        runs through one swappable function (MediaPipe today, BiRefNet-ready); the field is a geodesic
        distance transform, computed locally. Acceptance: the field reads ~0 at the scalp and ~1 at the
        ends even when hair curves sideways. Nothing here touches the working tester or the Gemini route.
      </p>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { v: T; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className={`inline-flex rounded-lg border border-neutral-300 p-0.5 ${disabled ? "opacity-50" : ""}`}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.v)}
          className={`rounded-md px-3 py-1.5 text-sm disabled:cursor-not-allowed ${
            value === o.v ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Render the root→tip field as a "jet"-style heatmap canvas: blue at the root
 * (t=0) through cyan/green/yellow to red at the tips (t=1). Pixels outside the
 * hair (field = NaN) are transparent so the photo shows through.
 */
function buildFieldHeatmap(rf: RootField): HTMLCanvasElement {
  const { field, width: w, height: h } = rf;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const t = field[i];
    if (Number.isNaN(t)) {
      rgba[i * 4 + 3] = 0; // transparent outside hair
      continue;
    }
    const hue = (1 - t) * 240; // 240° blue (root) → 0° red (tips)
    const [r, g, b] = hsvToRgb(hue, 1, 1);
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D context for the field heatmap.");
  ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  return canvas;
}

/** HSV→RGB. h in degrees [0,360), s and v in [0,1]; returns 0..255 channels. */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
