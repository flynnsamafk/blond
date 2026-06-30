"use client";

/**
 * GENERATIONS LAB — a read-only gallery of the images you've already made on the
 * working tester, surfaced inside the sandbox so you can pull one into a lab tool.
 *
 * It reads the SAME IndexedDB the main page writes to (per-origin), through the
 * existing `listGenerations()` helper — it does NOT add, edit, or delete history,
 * and makes no network/Gemini calls. Click any card to hand that image off to the
 * upscaler via `/lab/upscale?from=<id>`.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { listGenerations, type GenerationRecord } from "@/lib/generations";

type State =
  | { kind: "loading" }
  | { kind: "ready"; records: GenerationRecord[] }
  | { kind: "error" };

export default function GenerationsLabPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const records = await listGenerations();
        if (!cancelled) setState({ kind: "ready", records });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
          Generations Lab · read-only
        </p>
        <h1 className="text-xl font-semibold tracking-tight">Your past generations</h1>
        <p className="max-w-prose text-sm text-neutral-500">
          The images you&apos;ve created on the tester, stored locally in your browser. Click any one
          to send it to the <Link href="/lab/upscale" className="underline">Upscale lab</Link>. Nothing
          here is uploaded, and this view never changes your history.
        </p>
      </header>

      {state.kind === "loading" && (
        <p className="text-sm text-neutral-500">Loading your generations…</p>
      )}

      {state.kind === "error" && (
        <p className="text-sm text-red-500">Couldn&apos;t read your saved generations.</p>
      )}

      {state.kind === "ready" && state.records.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-10 text-center">
          <p className="text-sm font-medium text-neutral-700">No generations yet</p>
          <p className="mt-1 text-xs text-neutral-500">
            Make a few on the{" "}
            <Link href="/" className="underline">
              tester
            </Link>{" "}
            and they&apos;ll show up here.
          </p>
        </div>
      )}

      {state.kind === "ready" && state.records.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {state.records.map((r) => (
            <li key={r.id}>
              <Link
                href={`/lab/upscale?from=${encodeURIComponent(r.id)}`}
                className="group block overflow-hidden rounded-xl border border-neutral-200 bg-neutral-900"
              >
                <div className="relative aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.imageUrl}
                    alt={r.prompt || r.modelLabel}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium uppercase text-white">
                    {r.size}
                  </span>
                  <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-neutral-900">
                      Upscale →
                    </span>
                  </div>
                </div>
                <div className="space-y-0.5 px-2 py-1.5">
                  <p className="truncate text-xs font-medium text-neutral-200">{r.modelLabel}</p>
                  <p className="text-[11px] text-neutral-400">
                    {new Date(r.createdAt).toLocaleDateString()}
                    {r.kind ? ` · ${r.kind}` : ""}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
