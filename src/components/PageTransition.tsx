"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Route-change curtain. On navigation a near-black panel ramps UP to cover the
 * screen with the BLOND logo dead-centre, then ramps DOWN off the top to reveal
 * the new page. Driven by pathname changes; skips the very first load.
 */
export function PageTransition() {
  const pathname = usePathname();
  const [runId, setRunId] = useState(0);
  const [active, setActive] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setRunId((n) => n + 1);
    setActive(true);
    const t = setTimeout(() => setActive(false), 950);
    return () => clearTimeout(t);
  }, [pathname]);

  if (!active) return null;

  return (
    <div
      key={runId}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center bg-[#0a0a0b]"
      style={{ animation: "page-wipe 950ms cubic-bezier(0.7,0,0.3,1) forwards" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/Frame.png"
        alt=""
        className="h-12 w-auto"
        style={{ animation: "page-wipe-logo 950ms ease-out forwards" }}
      />
    </div>
  );
}
