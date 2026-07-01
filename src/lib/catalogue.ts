/**
 * Hairstyle catalogue — shared/global collections of ready-to-use styles,
 * stored in Supabase (`collections` + `hairstyles`, images in the `catalogue`
 * Storage bucket). RLS lets any signed-in staff read global rows; writes go to
 * global (owner_id null) for now (single-admin). All client-side.
 */
import { createClient } from "@/lib/supabase/client";

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  createdAt: string;
}

export interface Hairstyle {
  id: string;
  collectionId: string | null;
  name: string;
  imageUrl: string;
  gender: string | null;
  length: string | null;
  texture: string | null;
  tags: string[] | null;
  notes: string | null;
}

type CollectionRow = {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  created_at: string;
};
type HairstyleRow = {
  id: string;
  collection_id: string | null;
  name: string;
  image_url: string;
  gender: string | null;
  length: string | null;
  texture: string | null;
  tags: string[] | null;
  notes: string | null;
};

const toCollection = (r: CollectionRow): Collection => ({
  id: r.id,
  name: r.name,
  description: r.description,
  coverUrl: r.cover_url,
  createdAt: r.created_at,
});
const toHairstyle = (r: HairstyleRow): Hairstyle => ({
  id: r.id,
  collectionId: r.collection_id,
  name: r.name,
  imageUrl: r.image_url,
  gender: r.gender,
  length: r.length,
  texture: r.texture,
  tags: r.tags,
  notes: r.notes,
});

export async function listCollections(): Promise<Collection[]> {
  const { data, error } = await createClient()
    .from("collections")
    .select("*")
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as CollectionRow[]).map(toCollection);
}

export async function createCollection(
  name: string,
  description?: string,
): Promise<Collection | null> {
  const { data, error } = await createClient()
    .from("collections")
    .insert({ name, description: description ?? null, owner_id: null })
    .select()
    .single();
  if (error || !data) return null;
  return toCollection(data as CollectionRow);
}

export async function deleteCollection(id: string): Promise<void> {
  await createClient().from("collections").delete().eq("id", id);
}

export async function listHairstyles(collectionId?: string): Promise<Hairstyle[]> {
  let q = createClient().from("hairstyles").select("*").order("created_at", { ascending: true });
  if (collectionId) q = q.eq("collection_id", collectionId);
  const { data, error } = await q;
  if (error || !data) return [];
  return (data as HairstyleRow[]).map(toHairstyle);
}

export async function searchHairstyles(term: string): Promise<Hairstyle[]> {
  const clean = term.replace(/[%,]/g, " ").trim();
  const { data, error } = await createClient()
    .from("hairstyles")
    .select("*")
    .or(`name.ilike.%${clean}%,notes.ilike.%${clean}%`)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as HairstyleRow[]).map(toHairstyle);
}

export interface NewHairstyle {
  collectionId: string;
  name: string;
  file: File;
  gender?: string;
  length?: string;
  texture?: string;
  notes?: string;
  tags?: string[];
}

export async function addHairstyle(input: NewHairstyle): Promise<Hairstyle | null> {
  const supabase = createClient();
  const ext = input.file.name.split(".").pop()?.toLowerCase() || "jpg";
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const path = `styles/${id}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("catalogue")
    .upload(path, input.file, { upsert: false, contentType: input.file.type || "image/jpeg" });
  if (upErr) return null;

  const { data: pub } = supabase.storage.from("catalogue").getPublicUrl(path);

  const { data, error } = await supabase
    .from("hairstyles")
    .insert({
      collection_id: input.collectionId,
      owner_id: null,
      name: input.name,
      image_url: pub.publicUrl,
      gender: input.gender ?? null,
      length: input.length ?? null,
      texture: input.texture ?? null,
      notes: input.notes ?? null,
      tags: input.tags ?? null,
    })
    .select()
    .single();
  if (error || !data) return null;
  return toHairstyle(data as HairstyleRow);
}

export async function deleteHairstyle(id: string): Promise<void> {
  await createClient().from("hairstyles").delete().eq("id", id);
}
