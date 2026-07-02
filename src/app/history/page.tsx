"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import { listGenerations, type GenerationRecord } from "@/lib/generations";

/** Show just the front quarter of a 2×2 turnaround sheet. */
function frontQuarter(url: string): CSSProperties {
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: "200% 200%",
    backgroundPosition: "0% 0%",
    backgroundRepeat: "no-repeat",
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Magnifier background for the after-image's front quarter, centred on (lx,ly). */
function lensStyle(after: string, lx: number, ly: number, zoom: number): CSSProperties {
  const S = 2 * zoom; // background-size multiple within the lens box
  const imgX = clamp(lx * 0.5, 0, 0.5); // front quarter = top-left 50%×50% of the sheet
  const imgY = clamp(ly * 0.5, 0, 0.5);
  const bgX = clamp((imgX * S - 0.5) / (S - 1), 0, 1) * 100;
  const bgY = clamp((imgY * S - 0.5) / (S - 1), 0, 1) * 100;
  return {
    backgroundImage: `url("${after}")`,
    backgroundSize: `${S * 100}%`,
    backgroundPosition: `${bgX}% ${bgY}%`,
    backgroundRepeat: "no-repeat",
  };
}

interface CompareTarget {
  before: string;
  after: string;
  name: string;
}

export default function HistoryPage() {
  const [records, setRecords] = useState<GenerationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [compare, setCompare] = useState<CompareTarget | null>(null);

  useEffect(() => {
    let active = true;
    listGenerations().then((rows) => {
      if (!active) return;
      setRecords(rows);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const { bases, styledByBase } = useMemo(() => {
    const bases = records.filter((r) => r.kind === "base");
    const styledByBase = new Map<string, GenerationRecord[]>();
    for (const s of records) {
      if (s.kind !== "styled" || !s.baseId) continue;
      const arr = styledByBase.get(s.baseId) ?? [];
      arr.push(s);
      styledByBase.set(s.baseId, arr);
    }
    return { bases, styledByBase };
  }, [records]);

  return (
    <div className="space-y-6 py-6">
      <header>
        <h1 className="text-4xl font-extrabold tracking-tight text-black">History</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Your saved base profiles and every style you&apos;ve tried on them.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-neutral-500">Loading history…</p>
      ) : bases.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-12 text-center">
          <p className="text-sm font-medium text-neutral-700">No profiles yet</p>
          <p className="mt-1 text-xs text-neutral-500">Build a base profile on the tester and it&apos;ll appear here.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {bases.map((base) => {
            const styled = styledByBase.get(base.id) ?? [];
            const open = openId === base.id;
            return (
              <li key={base.id} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
                {/* Dropdown header */}
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : base.id)}
                  className="flex w-full items-center gap-4 p-3 text-left hover:bg-neutral-50"
                >
                  <span className="h-16 w-14 shrink-0 overflow-hidden rounded-lg bg-neutral-100">
                    <span className="block h-full w-full" style={frontQuarter(base.imageUrl)} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-neutral-900">
                      {base.customerName || "Unnamed customer"}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-neutral-500">
                      {base.attributes
                        ? [base.attributes.faceShape, base.attributes.hairline].filter(Boolean).join(" · ")
                        : "—"}
                    </span>
                    <span className="mt-0.5 block text-xs font-medium text-neutral-400">
                      {styled.length} style{styled.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    className={`shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}
                    aria-hidden
                  >
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {/* Styled images */}
                {open && (
                  <div className="border-t border-neutral-100 p-3">
                    {styled.length === 0 ? (
                      <p className="text-xs text-neutral-400">No styles tried on this profile yet.</p>
                    ) : (
                      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                        {styled.map((s) => (
                          <li key={s.id}>
                            <button
                              type="button"
                              onClick={() =>
                                setCompare({
                                  before: base.imageUrl,
                                  after: s.imageUrl,
                                  name: base.customerName || "Result",
                                })
                              }
                              className="group block w-full overflow-hidden rounded-lg border border-neutral-200"
                            >
                              <span className="block aspect-[3/4] bg-neutral-100">
                                <span
                                  className="block h-full w-full transition-transform duration-300 group-hover:scale-105"
                                  style={frontQuarter(s.imageUrl)}
                                />
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {compare && <CompareModal target={compare} onClose={() => setCompare(null)} />}
    </div>
  );
}

/** Before/after with a centre-out reveal on open + drag slider + desktop hover magnifier. */
function CompareModal({ target, onClose }: { target: CompareTarget; onClose: () => void }) {
  const [pct, setPct] = useState(50);
  const [lens, setLens] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const ZOOM = 2.2;

  const moveDivider = useCallback((clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPct(clamp(((clientX - r.left) / r.width) * 100, 0, 100));
  }, []);

  const onLens = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    setLens({ x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) });
  }, []);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-3"
        style={{ animation: "history-reveal 520ms cubic-bezier(0.6,0,0.2,1) both" }}
      >
        <div className="flex items-center justify-between text-white">
          <span className="font-semibold">{target.name}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="text-white/70 hover:text-white">
            ✕
          </button>
        </div>

        <div
          ref={ref}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            moveDivider(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) moveDivider(e.clientX);
            onLens(e);
          }}
          onPointerLeave={() => setLens(null)}
          className="relative aspect-[3/4] w-full touch-none overflow-hidden rounded-2xl border-2 border-white/20 bg-neutral-900"
        >
          {/* Before (base) underneath */}
          <div className="absolute inset-0" style={frontQuarter(target.before)} />
          {/* After (styled) clipped to the divider */}
          <div className="absolute inset-0" style={{ ...frontQuarter(target.after), clipPath: `inset(0 ${100 - pct}% 0 0)` }} />

          {/* Corner labels */}
          <span className="absolute left-2 top-2 rounded bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white" style={{ opacity: Math.min(1, pct / 15) }}>
            After
          </span>
          <span className="absolute right-2 top-2 rounded bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white" style={{ opacity: Math.min(1, (100 - pct) / 15) }}>
            Before
          </span>

          {/* Divider + handle */}
          <div className="pointer-events-none absolute inset-y-0" style={{ left: `${pct}%` }}>
            <div className="absolute inset-y-0 -ml-px w-0.5 bg-white/90" />
            <div className="absolute left-0 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[11px] tracking-[-0.15em] text-neutral-700 shadow">
              ◄►
            </div>
          </div>

          {/* Desktop hover magnifier (of the AFTER image) */}
          {lens && (
            <div
              className="pointer-events-none absolute hidden h-28 w-28 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border-2 border-white shadow-lg lg:block"
              style={{ left: `${lens.x * 100}%`, top: `${lens.y * 100}%`, ...lensStyle(target.after, lens.x, lens.y, ZOOM) }}
            />
          )}
        </div>
        <p className="text-center text-xs text-white/60">Drag to compare · hover to zoom (desktop)</p>
      </div>
    </div>
  );
}
