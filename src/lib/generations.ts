/**
 * Per-account generation history.
 *
 * When Supabase is configured (the app is signed-in / gated), generations are
 * saved to the `public.generations` table, scoped to the logged-in user by
 * Row-Level Security — so each account only ever sees its own, on any device.
 * When Supabase isn't configured (local dev without keys), it transparently
 * falls back to the on-device IndexedDB store.
 *
 * The API mirrors the old IndexedDB module so callers don't change.
 */
import { env } from "@/lib/env";
import * as idb from "@/lib/history";
import type { GenerationRecord } from "@/lib/history";
import { createClient } from "@/lib/supabase/client";

export type { GenerationRecord } from "@/lib/history";

/** Keep each account's history bounded. */
export const MAX_RECORDS = 30;

/** Shape of a row in public.generations. */
interface Row {
  id: string;
  created_at: string;
  image_url: string;
  model_id: string;
  model_label: string;
  size: string;
  tee: string;
  prompt: string;
  kind: string | null;
}

function rowToRecord(r: Row): GenerationRecord {
  return {
    id: r.id,
    createdAt: new Date(r.created_at).getTime(),
    imageUrl: r.image_url,
    modelId: r.model_id,
    modelLabel: r.model_label,
    size: r.size as GenerationRecord["size"],
    tee: r.tee as GenerationRecord["tee"],
    prompt: r.prompt,
    kind: (r.kind as GenerationRecord["kind"]) ?? undefined,
  };
}

const supabaseBacked = () => env.isConfigured;

/** Newest first. Returns [] on any failure (history is a convenience, never fatal). */
export async function listGenerations(): Promise<GenerationRecord[]> {
  if (!supabaseBacked()) return idb.listGenerations();
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("generations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(MAX_RECORDS);
    if (error || !data) return [];
    return (data as Row[]).map(rowToRecord);
  } catch {
    return [];
  }
}

/** Persist a generation for the current account. */
export async function addGeneration(record: GenerationRecord): Promise<void> {
  if (!supabaseBacked()) return idb.addGeneration(record);
  try {
    const supabase = createClient();
    // user_id is filled by the column default auth.uid(); RLS enforces ownership.
    await supabase.from("generations").insert({
      id: record.id,
      created_at: new Date(record.createdAt).toISOString(),
      image_url: record.imageUrl,
      model_id: record.modelId,
      model_label: record.modelLabel,
      size: record.size,
      tee: record.tee,
      prompt: record.prompt,
      kind: record.kind ?? "styled",
    });
    await prune(supabase);
  } catch {
    // ignore — never break the generation flow over a history write
  }
}

/** Trim the account's history down to the newest MAX_RECORDS rows. */
async function prune(supabase: ReturnType<typeof createClient>): Promise<void> {
  try {
    const { data } = await supabase
      .from("generations")
      .select("id")
      .order("created_at", { ascending: false })
      .range(MAX_RECORDS, MAX_RECORDS + 100);
    const ids = (data as { id: string }[] | null)?.map((d) => d.id) ?? [];
    if (ids.length) await supabase.from("generations").delete().in("id", ids);
  } catch {
    // ignore
  }
}

export async function deleteGeneration(id: string): Promise<void> {
  if (!supabaseBacked()) return idb.deleteGeneration(id);
  try {
    await createClient().from("generations").delete().eq("id", id);
  } catch {
    // ignore
  }
}

export async function clearGenerations(): Promise<void> {
  if (!supabaseBacked()) return idb.clearGenerations();
  try {
    // RLS scopes the delete to the current user's rows; the filter matches all.
    await createClient().from("generations").delete().gte("created_at", "1970-01-01T00:00:00Z");
  } catch {
    // ignore
  }
}
