"use client";

/**
 * Before/after comparison slider for the lab pages — a self-contained reimplementation
 * of the swipe-reveal feel from the working tester (which keeps its own copy inline).
 * The "after" image is overlaid and clipped with clip-path to a width driven by one
 * number (`pct`), so a single pointer drag wipes between the two.
 *
 * Both images are displayed in the same box (full width), so a lower-res "before"
 * and a 2× "after" line up exactly for a fair comparison.
 */

import { useCallback, useRef, useState } from "react";

export function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  beforeLabel = "Before",
  afterLabel = "After",
}: {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const [pct, setPct] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const moveTo = useCallback((clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = ((clientX - rect.left) / rect.width) * 100;
    setPct(Math.max(0, Math.min(100, next)));
  }, []);

  const onDown = useCallback(
    (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(true);
      setTouched(true);
      moveTo(e.clientX);
    },
    [moveTo],
  );

  const onMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragging) moveTo(e.clientX);
    },
    [dragging, moveTo],
  );

  const onUp = useCallback(() => setDragging(false), []);

  return (
    <div
      ref={ref}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="slider"
      aria-label="Before/after comparison"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      className={`relative touch-none select-none overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 ${
        dragging ? "cursor-grabbing" : "cursor-ew-resize"
      }`}
    >
      {/* "Before" sits in normal flow and sets the box height from its aspect ratio. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={beforeUrl} alt={beforeLabel} draggable={false} className="block h-auto w-full" />
      {/* "After" overlays it, clipped to `pct` width from the left. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={afterUrl}
        alt={afterLabel}
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
      />

      <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white">
        {beforeLabel}
      </span>
      <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white">
        {afterLabel}
      </span>

      {/* Divider + grab handle, both positioned at `pct`. */}
      <div className="pointer-events-none absolute inset-y-0" style={{ left: `${pct}%` }}>
        <div className="absolute inset-y-0 -ml-px w-0.5 bg-white shadow-[0_0_3px_rgba(0,0,0,0.45)]" />
        <div className="absolute top-1/2 -ml-3.5 -mt-3.5 flex h-7 w-7 items-center justify-center rounded-full border border-neutral-300 bg-white text-[10px] leading-none text-neutral-600 shadow">
          ◀▶
        </div>
      </div>

      {!touched && (
        <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white">
          Drag to compare
        </span>
      )}
    </div>
  );
}
