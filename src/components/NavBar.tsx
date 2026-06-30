"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * The Blond top nav. The hamburger opens a full-screen glassmorphism overlay
 * with the menu (incl. Sign out). Clicking empty space — or pressing Escape —
 * closes it. The logo is a plain link that can't be right-click-saved or dragged.
 */
export function NavBar({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);

  // Close on Escape, and lock body scroll while the overlay is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <header className="sticky top-4 z-50 w-full max-w-5xl mx-auto px-4 pointer-events-none">
      {/* Glassmorphism nav: translucent dark + backdrop blur, fully-rounded pill */}
      <div className="pointer-events-auto flex items-center justify-between bg-[#252525]/45 backdrop-blur-md text-white py-3.5 px-8 rounded-full shadow-lg border border-white/10 transition-all duration-300">
        <Link
          href="/"
          aria-label="Blond home"
          onContextMenu={(e) => e.preventDefault()}
          className="flex items-center active:scale-95 transition-transform duration-200"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/Frame.png"
            alt="BLOND"
            draggable={false}
            className="h-9 w-auto select-none object-contain pointer-events-none"
          />
        </Link>

        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="group flex flex-col justify-center items-end gap-2 w-9 h-9 rounded-lg hover:bg-white/10 active:scale-90 transition-all duration-200 focus:outline-none cursor-pointer"
        >
          <span className="w-7 h-[3px] bg-[#D9D9D9] rounded-full transition-all duration-300 group-hover:bg-white"></span>
          <span className="w-7 h-[3px] bg-[#D9D9D9] rounded-full transition-all duration-300 group-hover:bg-white"></span>
        </button>
      </div>

      {/* Full-screen glassmorphism menu overlay */}
      <div
        onClick={() => setOpen(false)}
        className={`pointer-events-auto fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#1c1c1c]/40 backdrop-blur-2xl transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!open}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
          className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        {/* Stop clicks on the menu itself from closing the overlay */}
        <nav
          onClick={(e) => e.stopPropagation()}
          className="flex flex-col items-center gap-7 text-white"
        >
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="text-3xl font-bold tracking-tight transition-colors hover:text-white/80"
          >
            Home
          </Link>
          {signedIn ? (
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="text-3xl font-bold tracking-tight text-white/85 transition-colors hover:text-white"
              >
                Sign out
              </button>
            </form>
          ) : (
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="text-3xl font-bold tracking-tight transition-colors hover:text-white/80"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
