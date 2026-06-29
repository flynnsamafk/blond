"use client";

import Link from "next/link";

export function Header() {
  return (
    <header className="sticky top-4 z-50 w-full max-w-5xl mx-auto px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center justify-between bg-[#3e3e3e]/90 backdrop-blur-md text-white py-3 px-6 rounded-full shadow-lg border border-[#4e4e4e]/40 transition-all duration-300">
        {/* Logo Link with click animation */}
        <Link 
          href="/" 
          className="flex items-center active:scale-95 transition-transform duration-200"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
            src="/Logo.svg" 
            alt="BLOND" 
            className="h-7 w-auto brightness-0 invert object-contain"
          />
        </Link>

        {/* Hamburger Menu Button with hover and click animations */}
        <button 
          type="button"
          className="group flex flex-col justify-center items-end gap-1.5 w-8 h-8 rounded-full hover:bg-white/10 active:scale-90 transition-all duration-200 focus:outline-none cursor-pointer"
          aria-label="Toggle menu"
        >
          <span className="w-5 h-0.5 bg-white rounded-full transition-all duration-300 group-hover:w-6 group-hover:bg-neutral-200"></span>
          <span className="w-4 h-0.5 bg-white rounded-full transition-all duration-300 group-hover:w-6 group-hover:bg-neutral-200"></span>
        </button>
      </div>
    </header>
  );
}
