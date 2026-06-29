/**
 * Local, on-device history for generated customer profiles.
 *
 * A 2K result is a multi-megabyte base64 data URL, which would blow past the
 * ~5 MB localStorage quota after one or two saves. So history lives in
 * IndexedDB (much larger quota, stores the full-resolution image). Everything
 * is client-side only — nothing is uploaded anywhere.
 *
 * Every call degrades gracefully: if IndexedDB is unavailable or a transaction
 * fails, the helpers resolve quietly instead of throwing, so a storage hiccup
 * can never break the actual generation flow.
 */

import type { ImageSize } from "@/lib/ai/models";

export interface GenerationRecord {
  /** Stable unique id. */
  id: string;
  /** Epoch ms the generation completed. */
  createdAt: number;
  /** Full-resolution result as a data URL. */
  imageUrl: string;
  /** Model id that produced it. */
  modelId: string;
  /** Human-readable model label (cached so old rows survive registry changes). */
  modelLabel: string;
  /** Output resolution. */
  size: ImageSize;
  /** T-shirt colour used. */
  tee: "black" | "white";
  /** The exact composed prompt that was sent. */
  prompt: string;
  /** Which stage produced it: a frozen base profile, or a styled (hair-applied) result. */
  kind?: "base" | "styled";
}

const DB_NAME = "hairstyle-tester";
const DB_VERSION = 1;
const STORE = "generations";

/** Keep history bounded so IndexedDB never grows without limit. */
export const MAX_RECORDS = 24;

function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open IndexedDB."));
  });
}

function runWrite(db: IDBDatabase, fn: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("History write aborted."));
  });
}

/** Newest first. Returns [] if storage is unavailable or empty. */
export async function listGenerations(): Promise<GenerationRecord[]> {
  if (!idbAvailable()) return [];
  let db: IDBDatabase;
  try {
    db = await openDB();
  } catch {
    return [];
  }
  try {
    const records = await new Promise<GenerationRecord[]>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as GenerationRecord[]);
      req.onerror = () => reject(req.error);
    });
    return records.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/**
 * Persist a generation. If the quota is exceeded we prune the oldest entries
 * and retry once; if it still fails we give up silently.
 */
export async function addGeneration(record: GenerationRecord): Promise<void> {
  if (!idbAvailable()) return;
  try {
    const db = await openDB();
    try {
      await runWrite(db, (store) => store.put(record));
    } finally {
      db.close();
    }
    await pruneToCount(MAX_RECORDS);
  } catch {
    // Likely QuotaExceededError — make room and retry once.
    try {
      await pruneToCount(Math.max(1, MAX_RECORDS - 6));
      const db = await openDB();
      try {
        await runWrite(db, (store) => store.put(record));
      } finally {
        db.close();
      }
    } catch {
      // History is a convenience, not critical — never throw to the caller.
    }
  }
}

export async function deleteGeneration(id: string): Promise<void> {
  if (!idbAvailable()) return;
  try {
    const db = await openDB();
    try {
      await runWrite(db, (store) => store.delete(id));
    } finally {
      db.close();
    }
  } catch {
    // ignore
  }
}

export async function clearGenerations(): Promise<void> {
  if (!idbAvailable()) return;
  try {
    const db = await openDB();
    try {
      await runWrite(db, (store) => store.clear());
    } finally {
      db.close();
    }
  } catch {
    // ignore
  }
}

/** Trim history down to the newest `keep` entries. */
async function pruneToCount(keep: number): Promise<void> {
  const all = await listGenerations();
  if (all.length <= keep) return;
  for (const rec of all.slice(keep)) {
    await deleteGeneration(rec.id);
  }
}
