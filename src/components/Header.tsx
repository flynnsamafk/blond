import Link from "next/link";

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function Header() {
  let signedIn = false;
  if (env.isConfigured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data.user);
  }

  return (
    <header className="sticky top-4 z-50 w-full max-w-5xl mx-auto px-4 pointer-events-none">
      {/* Glassmorphism nav: translucent dark + backdrop blur, fully-rounded pill */}
      <div className="pointer-events-auto flex items-center justify-between bg-[#252525]/45 backdrop-blur-md text-white py-3.5 px-8 rounded-full shadow-lg border border-white/10 transition-all duration-300">
        {/* Logo Link with click animation */}
        <Link
          href="/"
          className="flex items-center active:scale-95 transition-transform duration-200"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Frame.png" alt="BLOND" className="h-9 w-auto object-contain" />
        </Link>

        <div className="flex items-center gap-4">
          {/* Sign out — only when authenticated */}
          {signedIn && (
            <form action="/auth/signout" method="post" className="flex">
              <button
                type="submit"
                className="text-sm font-medium text-white/75 transition-colors hover:text-white"
              >
                Sign out
              </button>
            </form>
          )}

          {/* Hamburger Menu Button with hover and click animations */}
          <button
            type="button"
            className="group flex flex-col justify-center items-end gap-2 w-9 h-9 rounded-lg hover:bg-white/10 active:scale-90 transition-all duration-200 focus:outline-none cursor-pointer"
            aria-label="Toggle menu"
          >
            <span className="w-7 h-[3px] bg-[#D9D9D9] rounded-full transition-all duration-300 group-hover:bg-white"></span>
            <span className="w-7 h-[3px] bg-[#D9D9D9] rounded-full transition-all duration-300 group-hover:bg-white"></span>
          </button>
        </div>
      </div>
    </header>
  );
}
