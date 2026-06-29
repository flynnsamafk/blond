"use client";

import { useState } from "react";

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "sending" | "sent" | "error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!env.isConfigured) {
      setStatus("error");
      setMessage("Supabase is not configured yet. Add your keys to .env.local.");
      return;
    }

    setStatus("sending");
    setMessage("");

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setStatus("sent");
      setMessage("Check your email for a magic link to sign in.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not send magic link.");
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-4 py-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Staff sign in</h1>
        <p className="text-sm text-neutral-500">
          Sign in to manage the catalogue. Customers can browse without an account.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@salon.com"
          autoComplete="email"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
        />
        <button
          type="submit"
          disabled={status === "sending"}
          className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:bg-neutral-300"
        >
          {status === "sending" ? "Sending link..." : "Send magic link"}
        </button>
      </form>

      {message && (
        <p className={status === "error" ? "text-sm text-red-600" : "text-sm text-emerald-600"}>
          {message}
        </p>
      )}
    </div>
  );
}
