"use client";

/**
 * Sidebar navigation for the isolated `/lab/*` sandbox pages.
 *
 * Scoped to the lab nested layout only — it does NOT touch the app Header, the
 * root layout, or the working tester. The first link points back to the tester
 * ("← Tester") so the lab is a side-trip you can always leave. Active state is
 * derived from the current path: the tester link matches exactly, lab links match
 * by prefix so nested routes still highlight their section.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/", label: "← Tester", exact: true },
  { href: "/lab/color", label: "Color" },
  { href: "/lab/upscale", label: "Upscale" },
  { href: "/lab/generations", label: "Generations" },
];

export function LabSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sm:w-44 sm:shrink-0">
      <div className="sticky top-20">
        <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">
          Lab
        </p>
        <nav className="flex gap-1 overflow-x-auto pb-1 sm:flex-col sm:overflow-visible sm:pb-0">
          {LINKS.map((link) => {
            const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
