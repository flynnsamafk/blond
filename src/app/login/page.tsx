"use client";

import { useEffect, useRef, useState } from "react";

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "submitting" | "error";

// Hard ceiling so the button can NEVER stick on "Signing in…", whatever the SDK does.
const SIGN_IN_TIMEOUT = 15_000;

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  // Ref guard prevents a second in-flight submit (double-click / Enter spam).
  const inFlight = useRef(false);

  // If a session already exists (e.g. navigated here by mistake), go to the app.
  useEffect(() => {
    if (!env.isConfigured) return;
    let active = true;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (active && data.session) window.location.assign("/");
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    if (!env.isConfigured) {
      setStatus("error");
      setMessage("Supabase isn't configured yet. Add your project keys to .env.local.");
      return;
    }

    inFlight.current = true;
    setStatus("submitting");
    setMessage("");

    try {
      const supabase = createClient();
      const signIn = supabase.auth.signInWithPassword({ email: email.trim(), password });
      // Race the SDK call against a timeout so a hung lock can't freeze the UI.
      const { error } = await Promise.race([
        signIn,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("__timeout__")), SIGN_IN_TIMEOUT),
        ),
      ]);
      if (error) throw error;

      // Hard navigation → guarantees a clean client and that the gate sees the
      // fresh session cookie. Leave the button disabled while the page unloads.
      window.location.assign("/");
    } catch (error) {
      inFlight.current = false;
      setStatus("error");
      const msg =
        error instanceof Error && error.message === "__timeout__"
          ? "That took too long. Please try again."
          : error instanceof Error
            ? error.message
            : "Could not sign in. Check your details and try again.";
      setMessage(msg);
    }
  }

  const submitting = status === "submitting";

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
              disabled={submitting}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm outline-none transition-colors focus:border-black disabled:opacity-60"
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
              disabled={submitting}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm outline-none transition-colors focus:border-black disabled:opacity-60"
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-full bg-[#2B2B2B] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#3a3a3a] active:scale-[0.99] disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
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
