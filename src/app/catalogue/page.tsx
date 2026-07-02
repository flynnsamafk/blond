"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  addHairstyle,
  createCollection,
  deleteHairstyle,
  listCollections,
  listHairstyles,
  updateCollection,
  updateHairstyle,
  type Collection,
  type Hairstyle,
} from "@/lib/catalogue";

/** Hand a catalogue style off to the try-on flow on the home page. */
const TRY_ON_STYLE_KEY = "blond:tryOnStyle";

export default function CataloguePage() {
  const router = useRouter();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [styles, setStyles] = useState<Hairstyle[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [newCollection, setNewCollection] = useState<string | null>(null); // input value while creating
  const [addingTo, setAddingTo] = useState<Collection | null>(null);
  const [editingStyle, setEditingStyle] = useState<Hairstyle | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  async function refresh() {
    setLoading(true);
    const [cols, hs] = await Promise.all([listCollections(), listHairstyles()]);
    setCollections(cols);
    setStyles(hs);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    return styles.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.notes ?? "").toLowerCase().includes(q) ||
        (s.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [q, styles]);

  async function submitCollection() {
    const name = (newCollection ?? "").trim();
    if (!name) return;
    setNewCollection(null);
    const created = await createCollection(name);
    if (created) setCollections((c) => [...c, created]);
  }

  return (
    <div className="space-y-8 py-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-4xl font-extrabold tracking-tight text-black">Catalogue</h1>
          {newCollection === null ? (
            <button
              type="button"
              onClick={() => setNewCollection("")}
              className="rounded-full bg-[#2B2B2B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3a3a3a]"
            >
              New collection
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newCollection}
                onChange={(e) => setNewCollection(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitCollection()}
                placeholder="Collection name"
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-black"
              />
              <button
                type="button"
                onClick={submitCollection}
                className="rounded-full bg-[#2B2B2B] px-4 py-2 text-sm font-semibold text-white"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setNewCollection(null)}
                className="text-sm text-neutral-500 hover:text-neutral-800"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search hairstyles by name, tag or notes…"
          className="w-full rounded-full border border-neutral-300 px-5 py-3 text-sm outline-none focus:border-black"
        />
      </header>

      {loading ? (
        <p className="text-sm text-neutral-500">Loading catalogue…</p>
      ) : matches ? (
        /* Search results */
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-neutral-500">
            {matches.length} result{matches.length === 1 ? "" : "s"} for “{query}”
          </h2>
          <StyleGrid styles={matches} onDelete={(id) => void handleDelete(id)} onUse={useInTryOn} onEdit={setEditingStyle} />
        </section>
      ) : collections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-12 text-center">
          <p className="text-sm font-medium text-neutral-700">No collections yet</p>
          <p className="mt-1 text-xs text-neutral-500">Create a collection, then add hairstyles to it.</p>
        </div>
      ) : (
        collections.map((col) => {
          const colStyles = styles.filter((s) => s.collectionId === col.id);
          return (
            <section key={col.id} className="space-y-3">
              <div className="flex items-center justify-between gap-2 border-b border-neutral-100 pb-2">
                {renaming?.id === col.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      autoFocus
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: col.id, name: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && void saveRename()}
                      className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-black"
                    />
                    <button type="button" onClick={() => void saveRename()} className="rounded-full bg-[#2B2B2B] px-3 py-1.5 text-xs font-semibold text-white">
                      Save
                    </button>
                    <button type="button" onClick={() => setRenaming(null)} className="text-xs text-neutral-500 hover:text-neutral-800">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex min-w-0 items-center gap-2">
                      <h2 className="truncate text-xl font-bold text-black">{col.name}</h2>
                      <button
                        type="button"
                        onClick={() => setRenaming({ id: col.id, name: col.name })}
                        aria-label="Rename collection"
                        className="text-neutral-400 hover:text-black"
                      >
                        ✎
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAddingTo(col)}
                      className="shrink-0 rounded-full border border-neutral-300 px-4 py-1.5 text-sm font-medium text-neutral-700 hover:border-black"
                    >
                      + Add style
                    </button>
                  </>
                )}
              </div>
              {colStyles.length === 0 ? (
                <p className="text-xs text-neutral-400">No styles in this collection yet.</p>
              ) : (
                <StyleGrid
                  styles={colStyles}
                  onDelete={(id) => void handleDelete(id)}
                  onUse={useInTryOn}
                  onEdit={setEditingStyle}
                />
              )}
            </section>
          );
        })
      )}

      {addingTo && (
        <AddStyleModal
          collection={addingTo}
          onClose={() => setAddingTo(null)}
          onAdded={(hs) => {
            setStyles((s) => [...s, hs]);
            setAddingTo(null);
          }}
        />
      )}

      {editingStyle && (
        <EditStyleModal
          style={editingStyle}
          onClose={() => setEditingStyle(null)}
          onSaved={(updated) => {
            setStyles((s) => s.map((x) => (x.id === updated.id ? updated : x)));
            setEditingStyle(null);
          }}
        />
      )}
    </div>
  );

  async function handleDelete(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Delete this style?")) return;
    setStyles((s) => s.filter((x) => x.id !== id));
    await deleteHairstyle(id);
  }

  async function saveRename() {
    if (!renaming) return;
    const name = renaming.name.trim();
    const { id } = renaming;
    setRenaming(null);
    if (!name) return;
    setCollections((cs) => cs.map((c) => (c.id === id ? { ...c, name } : c)));
    await updateCollection(id, { name });
  }

  function useInTryOn(style: Hairstyle) {
    sessionStorage.setItem(
      TRY_ON_STYLE_KEY,
      JSON.stringify({ imageUrl: style.imageUrl, name: style.name, notes: style.notes ?? "" }),
    );
    router.push("/");
  }
}

function StyleGrid({
  styles,
  onDelete,
  onUse,
  onEdit,
}: {
  styles: Hairstyle[];
  onDelete: (id: string) => void;
  onUse: (s: Hairstyle) => void;
  onEdit: (s: Hairstyle) => void;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {styles.map((s) => (
        <li key={s.id} className="group relative overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="relative aspect-[3/4] bg-neutral-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.imageUrl} alt={s.name} className="h-full w-full object-cover" />
            <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => onEdit(s)}
                aria-label="Edit style"
                className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-xs text-white"
              >
                ✎
              </button>
              <button
                type="button"
                onClick={() => onDelete(s.id)}
                aria-label="Delete style"
                className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-sm text-white"
              >
                ×
              </button>
            </div>
          </div>
          <div className="space-y-1.5 p-2.5">
            <div className="space-y-0.5">
              <p className="truncate text-sm font-semibold text-neutral-900">{s.name}</p>
              <p className="truncate text-[11px] capitalize text-neutral-500">
                {[s.gender, s.length, s.texture].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onUse(s)}
              className="w-full rounded-full bg-[#2B2B2B] py-1.5 text-xs font-semibold text-white hover:bg-[#3a3a3a]"
            >
              Use in try-on
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AddStyleModal({
  collection,
  onClose,
  onAdded,
}: {
  collection: Collection;
  onClose: () => void;
  onAdded: (hs: Hairstyle) => void;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [gender, setGender] = useState("");
  const [length, setLength] = useState("");
  const [texture, setTexture] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function save() {
    if (!name.trim() || !file) {
      setError("A name and an image are required.");
      return;
    }
    setSaving(true);
    setError(null);
    const hs = await addHairstyle({
      collectionId: collection.id,
      name: name.trim(),
      file,
      gender: gender || undefined,
      length: length || undefined,
      texture: texture || undefined,
      notes: notes || undefined,
    });
    setSaving(false);
    if (hs) onAdded(hs);
    else setError("Upload failed. Check the image and try again.");
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-5 shadow-xl"
      >
        <h3 className="text-base font-bold text-neutral-900">
          Add style to <span className="text-neutral-500">{collection.name}</span>
        </h3>

        <label className="block cursor-pointer overflow-hidden rounded-lg border border-dashed border-neutral-300 bg-neutral-50 hover:border-black">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Preview" className="h-40 w-full object-cover" />
          ) : (
            <span className="flex h-24 items-center justify-center text-sm text-neutral-500">
              Upload hairstyle image
            </span>
          )}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </label>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Style name"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-black"
        />
        <div className="grid grid-cols-3 gap-2">
          <input value={gender} onChange={(e) => setGender(e.target.value)} placeholder="Gender" className="rounded-lg border border-neutral-300 px-2 py-2 text-sm outline-none focus:border-black" />
          <input value={length} onChange={(e) => setLength(e.target.value)} placeholder="Length" className="rounded-lg border border-neutral-300 px-2 py-2 text-sm outline-none focus:border-black" />
          <input value={texture} onChange={(e) => setTexture(e.target.value)} placeholder="Texture" className="rounded-lg border border-neutral-300 px-2 py-2 text-sm outline-none focus:border-black" />
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Fit notes — parting, cowlick handling, who it suits…"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-black"
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-full bg-[#2B2B2B] px-5 py-2 text-sm font-semibold text-white hover:bg-[#3a3a3a] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Add style"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditStyleModal({
  style,
  onClose,
  onSaved,
}: {
  style: Hairstyle;
  onClose: () => void;
  onSaved: (s: Hairstyle) => void;
}) {
  const [name, setName] = useState(style.name);
  const [gender, setGender] = useState(style.gender ?? "");
  const [length, setLength] = useState(style.length ?? "");
  const [texture, setTexture] = useState(style.texture ?? "");
  const [notes, setNotes] = useState(style.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    const patch = {
      name: name.trim(),
      gender: gender || null,
      length: length || null,
      texture: texture || null,
      notes: notes || null,
    };
    await updateHairstyle(style.id, patch);
    setSaving(false);
    onSaved({ ...style, ...patch });
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-5 shadow-xl"
      >
        <h3 className="text-base font-bold text-neutral-900">Edit style</h3>
        <div className="h-32 overflow-hidden rounded-lg bg-neutral-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={style.imageUrl} alt={style.name} className="h-full w-full object-cover" />
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Style name"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-black"
        />
        <div className="grid grid-cols-3 gap-2">
          <input value={gender} onChange={(e) => setGender(e.target.value)} placeholder="Gender" className="rounded-lg border border-neutral-300 px-2 py-2 text-sm outline-none focus:border-black" />
          <input value={length} onChange={(e) => setLength(e.target.value)} placeholder="Length" className="rounded-lg border border-neutral-300 px-2 py-2 text-sm outline-none focus:border-black" />
          <input value={texture} onChange={(e) => setTexture(e.target.value)} placeholder="Texture" className="rounded-lg border border-neutral-300 px-2 py-2 text-sm outline-none focus:border-black" />
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Fit notes — parting, cowlick handling, who it suits…"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-black"
        />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-full bg-[#2B2B2B] px-5 py-2 text-sm font-semibold text-white hover:bg-[#3a3a3a] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
