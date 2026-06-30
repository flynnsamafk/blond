"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "submitting" | "error";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!env.isConfigured) {
      setStatus("error");
      setMessage("Supabase isn't configured yet. Add your project keys to .env.local.");
      return;
    }

    setStatus("submitting");
    setMessage("");

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // Session cookie is set; re-run the server so the gate lets us through.
      router.replace("/");
      router.refresh();
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "Could not sign in. Check your details and try again.",
      );
    }
  }

  return (
    <div className="flex min-h-[72vh] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-black">Staff sign in</h1>
          <p className="mt-1.5 text-sm text-neutral-500">Sign in to use Blond.</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-neutral-600">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@salon.com"
              autoComplete="email"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm outline-none transition-colors focus:border-black"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-neutral-600">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm outline-none transition-colors focus:border-black"
            />
          </label>

          <button
            type="submit"
            disabled={status === "submitting"}
            className="w-full rounded-full bg-[#2B2B2B] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#3a3a3a] active:scale-[0.99] disabled:opacity-50"
          >
            {status === "submitting" ? "Signing in…" : "Sign in"}
          </button>

          {message && <p className="pt-1 text-sm text-red-600">{message}</p>}
        </form>

        <p className="mt-4 text-center text-xs text-neutral-400">
          Staff accounts are issued by your salon admin.
        </p>
      </div>
    </div>
  );
}
