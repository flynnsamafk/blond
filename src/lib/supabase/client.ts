import { createBrowserClient } from "@supabase/ssr";

import { env } from "@/lib/env";

/**
 * gotrue-js serialises auth calls with the Web Locks API (navigator.locks).
 * During SPA navigations or rapid sign-in → sign-out cycles that lock can be
 * left held, which makes the NEXT signInWithPassword() hang forever (the
 * dreaded infinite "Signing in…"). We replace it with a lightweight in-memory
 * lock that serialises calls within the page but never blocks across
 * navigations or tabs, so sign-in can't get stuck.
 */
let queue: Promise<unknown> = Promise.resolve();
function memoryLock<R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Supabase client for use in Client Components / the browser.
 * Only call this when `env.isConfigured` is true.
 */
export function createClient() {
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { lock: memoryLock },
  });
}
