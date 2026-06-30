"use client";

/**
 * UPSCALE LAB — isolated dev page for evaluating free, in-browser super-resolution.
 *
 * Sandbox only: it does NOT touch the working tester, /api/try-on, models, prompts
 * or the Gemini route, and makes NO Gemini calls. An image comes either from an
 * upload/drag-drop OR from one of your past generations (read-only, via
 * `?from=<id>` and the existing history helper); everything is processed locally
 * (model weights fetched once from a CDN, like MediaPipe).
 *
 * Purpose: eyeball whether Real-ESRGAN (via the swappable `upscaleImage()`
 * boundary) is good enough to generate at 1K and upscale to 2K for free, instead
 * of paying Gemini's 2K price. A drag-to-compare slider puts the AI 2× against the
 * raw original; the segmented control also flips to a plain bicubic 2× baseline.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { BeforeAfterSlider } from "@/components/lab/BeforeAfterSlider";
import { listGenerations } from "@/lib/generations";
import { UPSCALE_SCALE, upscaleImage } from "@/lib/upscale/upscale";

// Cap the input so the test stays snappy. The model tiles internally, so larger
// inputs work too — they're just slower. Bump this to 1024 to test the exact
// 1K → 2K case.
const MAX_DIM = 768;

type View = "slider" | "esrgan" | "bicubic" | "original";

type Info = {
  inW: number;
  inH: number;
  outW: number;
  outH: number;
  ms: number;
  backend: string;
};

/** Data URLs for the drag-to-compare slider (raw original vs. AI 2×). */
type Compare = { before: string; after: string };

type Status =
  | { kind: "idle" }
  | { kind: "working"; note: string }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export default function UpscaleLabPage() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [view, setView] = useState<View>("slider");
  const [dragOver, setDragOver] = useState(false);
  const [info, setInfo] = useState<Info | null>(null);
  const [compare, setCompare] = useState<Compare | null>(null);

  const sourceRef = useRef<HTMLCanvasElement | null>(null); // capped original (1×)
  const esrganRef = useRef<HTMLCanvasElement | null>(null); // Real-ESRGAN 2×
  const bicubicRef = useRef<HTMLCanvasElement | null>(null); // classical 2× baseline
  const displayRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoloadedRef = useRef(false); // guard so ?from= only loads once

  /** Draw the selected canvas view into the on-screen canvas, all at the 2× size. */
  const render = useCallback(() => {
    const display = displayRef.current;
    const source = sourceRef.current;
    if (!display || !source) return;

    const outW = source.width * UPSCALE_SCALE;
    const outH = source.height * UPSCALE_SCALE;
    display.width = outW;
    display.height = outH;
    const ctx = display.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, outW, outH);

    if (view === "esrgan" && esrganRef.current) {
      ctx.drawImage(esrganRef.current, 0, 0);
      return;
    }
    if (view === "bicubic" && bicubicRef.current) {
      ctx.drawImage(bicubicRef.current, 0, 0);
      return;
    }
    // "original": blow the raw pixels up with nearest-neighbour so you see exactly
    // what we started from, at the same on-screen size as the two 2× results.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, outW, outH);
    ctx.imageSmoothingEnabled = true;
  }, [view]);

  useEffect(() => {
    render();
  }, [render]);

  /**
   * The shared pipeline: take any drawable (an uploaded bitmap or a past
   * generation) at its natural size, cap it, build the bicubic baseline, run the
   * AI upscale, and stage the slider. Both entry points funnel through here.
   */
  const processInput = useCallback(
    async (drawable: CanvasImageSource, naturalW: number, naturalH: number) => {
      setStatus({ kind: "working", note: "Preparing image…" });
      setInfo(null);
      setCompare(null);
      esrganRef.current = null;
      try {
        // Downscale into the source canvas (1×, capped).
        const scale = Math.min(1, MAX_DIM / Math.max(naturalW, naturalH));
        const inW = Math.max(1, Math.round(naturalW * scale));
        const inH = Math.max(1, Math.round(naturalH * scale));
        const source = document.createElement("canvas");
        source.width = inW;
        source.height = inH;
        const sctx = source.getContext("2d");
        if (!sctx) throw new Error("Could not get a 2D context.");
        sctx.drawImage(drawable, 0, 0, inW, inH);
        sourceRef.current = source;

        // Classical 2× baseline (bicubic / high-quality smoothing) for comparison.
        const outW = inW * UPSCALE_SCALE;
        const outH = inH * UPSCALE_SCALE;
        const bicubic = document.createElement("canvas");
        bicubic.width = outW;
        bicubic.height = outH;
        const bctx = bicubic.getContext("2d");
        if (!bctx) throw new Error("Could not get a 2D context.");
        bctx.imageSmoothingEnabled = true;
        bctx.imageSmoothingQuality = "high";
        bctx.drawImage(source, 0, 0, outW, outH);
        bicubicRef.current = bicubic;

        // Show the bicubic result immediately while the AI runs.
        setView("bicubic");
        requestAnimationFrame(render);

        setStatus({
          kind: "working",
          note: "Upscaling with Real-ESRGAN… (first run downloads the model)",
        });
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const result = await upscaleImage(source, {
          onProgress: (rate) =>
            setStatus({ kind: "working", note: `Upscaling with Real-ESRGAN… ${Math.round(rate * 100)}%` }),
        });
        esrganRef.current = result.canvas;

        // Stage the drag-to-compare slider: raw original vs. AI 2×.
        setCompare({
          before: source.toDataURL("image/png"),
          after: result.canvas.toDataURL("image/png"),
        });
        setInfo({ inW, inH, outW: result.width, outH: result.height, ms: result.ms, backend: result.backend });
        setStatus({ kind: "ready" });
        setView("slider");
        requestAnimationFrame(render);
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "Something went wrong.",
        });
      }
    },
    [render],
  );

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file || !file.type.startsWith("image/")) return;
      // Decode (respect EXIF) into a bitmap, then hand off to the shared pipeline.
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        try {
          bitmap = await createImageBitmap(file);
        } catch {
          setStatus({ kind: "error", message: "Could not read that image file." });
          return;
        }
      }
      try {
        await processInput(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    },
    [processInput],
  );

  const loadFromHistory = useCallback(
    async (id: string) => {
      setStatus({ kind: "working", note: "Loading from your generations…" });
      try {
        const records = await listGenerations();
        const record = records.find((r) => r.id === id);
        if (!record) {
          setStatus({ kind: "error", message: "That generation is no longer in your history." });
          return;
        }
        const img = await loadImage(record.imageUrl);
        await processInput(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
      } catch {
        setStatus({ kind: "error", message: "Could not load that generation." });
      }
    },
    [processInput],
  );

  // If we arrived via `/lab/upscale?from=<id>`, pull that past generation in once.
  useEffect(() => {
    if (autoloadedRef.current) return;
    autoloadedRef.current = true;
    const from = new URLSearchParams(window.location.search).get("from");
    if (from) void loadFromHistory(from);
  }, [loadFromHistory]);

  const ready = status.kind === "ready";
  const working = status.kind === "working";

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
          Upscale Lab · isolated sandbox
        </p>
        <h1 className="text-xl font-semibold tracking-tight">Free 2× super-resolution test</h1>
        <p className="max-w-prose text-sm text-neutral-500">
          Upload an image, or open one of your{" "}
          <a href="/lab/generations" className="underline">
            past generations
          </a>
          , to upscale it 2× with the swappable{" "}
          <code className="rounded bg-neutral-100 px-1">upscaleImage()</code> boundary (Real-ESRGAN,
          in-browser). Drag the <em>Slider</em> to compare the AI result against the original, or flip
          to a plain <em>Bicubic 2×</em> baseline. No Gemini calls; your image stays in the browser.
          Watch faces especially.
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
          {ready ? "Drop another image, or click to browse" : "Drop an image here, or click to browse"}
        </span>
        <span className="text-xs text-neutral-400">
          PNG or JPG · processed locally · input capped to {MAX_DIM}px, output {MAX_DIM * UPSCALE_SCALE}px
        </span>
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
            { v: "slider", label: "Slider" },
            { v: "esrgan", label: "ESRGAN 2×" },
            { v: "bicubic", label: "Bicubic 2×" },
            { v: "original", label: "Original" },
          ]}
        />
        {info && (
          <p className="text-xs text-neutral-500">
            {info.inW}×{info.inH} → {info.outW}×{info.outH}px · {(info.ms / 1000).toFixed(1)}s ·{" "}
            <span className="font-medium text-neutral-700">{info.backend}</span>
          </p>
        )}
      </div>

      {/* Preview: drag-to-compare slider, or the canvas for the static views. */}
      {view === "slider" && ready && compare ? (
        <BeforeAfterSlider
          beforeUrl={compare.before}
          afterUrl={compare.after}
          beforeLabel="Original"
          afterLabel="ESRGAN 2×"
        />
      ) : (
        <div className="relative overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
          <canvas ref={displayRef} className="block h-auto w-full" />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              {status.kind === "error" ? (
                <p className="max-w-sm text-sm text-red-400">{status.message}</p>
              ) : working ? (
                <p className="text-sm text-neutral-300">{status.note}</p>
              ) : (
                <p className="text-sm text-neutral-500">No image yet — upload one to compare upscalers.</p>
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-neutral-400">
        Isolated test page at <code className="rounded bg-neutral-100 px-1">/lab/upscale</code>. Upscaling
        runs through one swappable function (Real-ESRGAN today; ONNX/WebGPU or server-side ncnn later).
        First run downloads the model from a CDN, then it&apos;s cached. Nothing here touches the working
        tester or the Gemini route.
      </p>
    </div>
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load that image."));
    img.src = url;
  });
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
