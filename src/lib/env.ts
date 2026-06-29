/**
 * Centralised access to public environment variables.
 *
 * `isConfigured` lets the rest of the app degrade gracefully (sample data,
 * disabled auth) before real Supabase keys are present, so the UI is fully
 * usable on first clone.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const env = {
  supabaseUrl,
  supabaseAnonKey,
  isConfigured: Boolean(supabaseUrl && supabaseAnonKey),
} as const;
