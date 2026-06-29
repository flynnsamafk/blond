# Salon Hairstyle Try-On — Session Report

_Date: 2026-06-21 · Project: `salon-template` · Dev server: port 3008_

## What this is
A **test harness** (not the final product UI) to prove one thing before building further:
**can the AI take a customer's front + side photo (identity) + a reference hairstyle, and
return a clean studio headshot of that same customer wearing the new hairstyle?**

Stack: Next.js 15.5.19, React 19, TypeScript, Tailwind 4. Image generation via Google
Gemini "Nano Banana" image models (REST: `generativelanguage.googleapis.com`).

---

## What we have right now (working)
- **End-to-end pipeline:** upload front / side / reference → `POST /api/try-on` → Gemini →
  one front-facing studio portrait. Plumbing confirmed (HTTP 200, image returned).
- **Models** (all reachable with the current key):
  | Model | Notes | Cost (1K / 2K) | Sizes |
  |---|---|---|---|
  | `gemini-3-pro-image` (Nano Banana 2) | Best at following instructions — **now the default** | $0.134 / $0.134 | 1K, 2K |
  | `gemini-3.1-flash-image` | Fast, cheaper | $0.067 / $0.101 | 1K, 2K |
  | `gemini-2.5-flash-image` | Cheapest | $0.039 / — | 1K only |
- **Defaults (changed this session): Pro + 1K** — for reliability (Pro) and speed (1K ≈ 15s).
- **Resolution:** 1K ≈ 896×1200, 2K ≈ 1792×2400 (2K confirmed > 1080p).
- **Prompt:** rewritten so the hair swap is the lead, forceful instruction (extract ONLY the
  hair from image 3, ignore that person's face/beard, recut customer's hair to match); face
  features explicitly preserved; output rendered as a calm-lit 85mm headshot on a muted grey
  backdrop. Editable in the UI; "Reset to default" restores it.
- **Local history (new):** last 24 generations saved **on-device in IndexedDB** (full-res +
  model/size/tee/prompt/timestamp). Click a thumbnail to reload that result and its settings;
  per-item delete; "Clear all". Nothing is uploaded. (Not localStorage — a 2K image is ~3 MB
  and would overflow its ~5 MB quota.)
- **Error handling hardened:** client aborts at 150s; server self-aborts the Gemini call at
  140s (→ clean 504); empty-photo guard; Gemini `finishReason`/`blockReason` surfaced; clear
  network/timeout messages; generate button always resets.
- **Verified this session:** `tsc` clean, `next lint` clean, homepage 200, route validates bad
  input without calling Gemini (no credits spent).

---

## Problems faced

### 1. PRIMARY (UNSOLVED): hair-swap passthrough
The Flash models (2.5 and 3.1) return the customer with their **original hair** — they change
the background / framing / lighting but **do not apply the reference hairstyle.** Last visible
result (2.5 Flash) still had the customer's original bowl-cut, not the reference crop.

- Tried: rewrote the prompt twice (made hair the primary instruction, then forced cross-person
  extraction); switched default to Pro.
- **NOT yet confirmed whether Pro fixes it.** This is the decisive open test.
- If Pro also fails → the reference image is likely ambiguous (last one was a 3/4 profile of a
  different bearded man); try a clear, front-on hair reference, and/or anchor the prompt harder.

### 2. Latency / "generates indefinitely"
Gemini's image endpoint has large latency swings — the log showed responses of **91s and 150s**
at 2K. The old 90s client timeout was cutting off a run that *finished at 91s*, so it looked
broken. **This is Google-side latency, not a code bug, and not an outage/quota** (responses were
`200`, no 429/503). Mitigated by: 1K default + raised timeouts (client 150s / server 140s).
2K is still slow — prefer 1K while iterating.

### 3. Dev server wedging ("page loads forever")
Two causes seen: (a) running `npm run build` while `next dev` is live corrupts `.next`;
(b) the single dev compiler can wedge after long/heavy requests, blocking all routes.
**Fix:** kill dev → (optionally `rm -rf .next`) → restart `npm run dev -- -p 3008`.
Happened this session; resolved by a clean restart.

### 4. Production constraint (future, not now)
`maxDuration` is capped by the host (Vercel Hobby = 60s, Pro = 300s). 2K runs that take >60s
would be cut off in production. Fine for local testing; revisit before deploying.

---

## Security / housekeeping
- **Rotate the Gemini API key when done testing.** It lives in `.env.local` and has been pasted
  in chat. New key: https://aistudio.google.com/apikey (project number 287675694165).
- No git repo initialized. Backup zip exists: `_backup-src-20260621.zip`.

---

## Next actions (for the morning)
1. **Hard-refresh the tab, then run ONE generation on the new default (Pro · 1K)** with real
   front / side / reference images. This decides whether the hair swap actually works.
2. If hair still not applied → use a **clearer, front-facing reference hairstyle**; if it still
   fails, anchor the prompt harder or consider hair-segmentation/inpainting.
3. If Pro works → test `3.1-flash` to see if prompt tuning makes the cheaper model viable.
4. Rotate the API key.

## Key files
- `src/components/HairstyleTester.tsx` — UI, prompt, history wiring
- `src/lib/ai/tryOn.ts` — client request + downscale + timeout
- `src/app/api/try-on/route.ts` — server route → Gemini
- `src/lib/ai/models.ts` — model registry + defaults
- `src/lib/history.ts` — IndexedDB history store
