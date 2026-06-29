# AI Hairstyle Tester — Project Breakdown

> A handoff document written so another developer (or LLM) can pick up this
> project cold. Code is the source of truth; where comments/examples disagree
> with the code, the disagreements are flagged below.

## 1. What this app is

A single-page web tool for a hair salon. A staff member uploads a customer's
**front + side photo**, and the app uses Google's Gemini "Nano Banana"
image-to-image models to:

1. **Build a "base profile"** — one generated image that locks the customer's
   identity and shows them from four angles (a turnaround sheet), keeping their
   *current* hair.
2. **Try on hairstyles** — repeatedly apply a reference hairstyle photo *on top
   of* that frozen face, so every result looks like the same person with a
   different cut.

Everything runs client-side except one thin server route that proxies Gemini.
There is no database in use; generated results are saved only in the browser
(IndexedDB).

## 2. Stack & versions

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** (CSS-first config in `globals.css`, `@import "tailwindcss"`)
- **Supabase SSR** packages are installed and wired but **dormant** — auth is
  fully gated behind `env.isConfigured`, which is false with no keys.
- **No image-processing libraries** are installed (relevant to the pending
  "cutout" decision below — any transparency work needs a new dependency or
  hand-written canvas code).
- Scripts: `dev`, `build`, `start`, `lint`, `typecheck`.

## 3. File map (everything under `src/`)

```
src/
  app/
    layout.tsx              Root layout: <Header/> + <main> wrapper, metadata
    page.tsx                Home — renders <HairstyleTester/> and nothing else
    globals.css             Tailwind v4 theme; a "quiet luxury" gold palette (unused by tester)
    api/try-on/route.ts     THE server endpoint — generic Gemini image proxy
    login/page.tsx          Magic-link sign-in (dormant Supabase)
    auth/callback/route.ts  OAuth/OTP callback (dormant)
    auth/signout/route.ts   Sign-out (dormant)
  components/
    HairstyleTester.tsx     THE app — 1000+ lines, the entire UI + pipeline (client)
    Header.tsx              Sticky header; shows email / sign-in (dormant auth)
  lib/
    ai/models.ts            Model registry, per-stage tiers, cost helpers
    ai/tryOn.ts             Client helper: downscale images, POST to /api/try-on
    history.ts              IndexedDB-backed generation history
    env.ts                  Reads NEXT_PUBLIC_SUPABASE_* → isConfigured flag
    supabase/{client,server,middleware}.ts   Dormant auth scaffolding
  middleware.ts             Refreshes Supabase session (no-op when unconfigured)
```

Two files matter most: **`components/HairstyleTester.tsx`** (all UI +
orchestration) and **`app/api/try-on/route.ts`** (the only server logic).

## 4. The core idea: a two-stage pipeline over one generic endpoint

The pipeline has two generative stages, but **both go through the same dumb
endpoint**. The route never knows what an image "means"; it just forwards an
**ordered list of images** + a **prompt**, and the prompt refers to them as
"Image 1", "Image 2", … in append order.

| Stage | Images sent (in order) | Prompt | Output |
|-------|------------------------|--------|--------|
| **base** ("Customer profile") | `[frontPhoto, sidePhoto]` | `DEFAULT_BASE_PROMPT` | One **2×2 turnaround sheet** of the customer with their *own* hair |
| **apply** ("Try a hairstyle") | `[baseHeadshot, hairReference]` | `DEFAULT_APPLY_PROMPT` | The base with **only the hair repainted** to the reference cut |

The base is generated **once** per customer and frozen. Step 2 reuses it as
"Image 1" so identity never drifts between hairstyle attempts. The base image is
stored as a data URL; to re-send it as an input it's converted back to a Blob
(`dataUrlToBlob`).

## 5. The server route contract (`/api/try-on`)

- **Runtime:** `nodejs`, `maxDuration = 300`. Needs `Buffer`; image gen can take
  10–90s+.
- **Auth to Google:** `GEMINI_API_KEY` or `GOOGLE_API_KEY` from env. Missing →
  HTTP 501 with a clear "not configured" message.
- **Request:** `multipart/form-data` with:
  - `model` — id from `models.ts` (defaults to `DEFAULT_MODEL_ID`)
  - `size` — `"1K"` | `"2K"` (clamped to what the model supports)
  - `prompt` — required full instruction text
  - `image` — **repeated** field, one per image, **order = Image 1, 2, …**
- **Upstream call:** `POST https://generativelanguage.googleapis.com/v1beta/models/{modelId}:generateContent`
  with body:
  ```
  contents: [{ role: "user", parts: [ {text: prompt}, ...{inlineData:{mimeType,data(base64)}} ] }]
  generationConfig: { responseModalities: ["TEXT","IMAGE"], imageConfig: { aspectRatio: "3:4", imageSize: size } }
  ```
- **Resilience:** Retries statuses `{429,500,502,503,504}` with exponential
  backoff + jitter (honours `Retry-After`), up to 4 attempts, all inside a
  **140s total budget**. Each attempt self-aborts on remaining budget so the
  route's clean error beats the client's 150s abort. Drains error bodies between
  retries to free the socket.
- **Response:** `{ imageUrl: "data:<mime>;base64,…" }` on success, else
  `{ error }` with a status (501/400/502/503/504). Handles the "model returned
  text/blockReason/finishReason but no image" case with a specific message.

**Client side (`lib/ai/tryOn.ts`):** before POSTing, it **downscales** each
image in-browser to max dimension 1536px (respects EXIF orientation, re-encodes
JPEG q0.9) to keep request bodies sane without starving the 2K output. Wraps the
fetch in a 150s `AbortController`. Returns the data URL or throws the server's
error message.

## 6. Model registry & per-stage tiers (`lib/ai/models.ts`)

Three image-to-image models, all "Nano Banana" family (text-to-image Imagen was
removed because it can't preserve a face):

| id | label | sizes | cost (USD) |
|----|-------|-------|------------|
| `gemini-3.1-flash-image` | 3.1 Flash Image (Nano Banana) | 1K, 2K | 1K $0.067 / 2K $0.101 |
| `gemini-3-pro-image` | 3 Pro Image (Nano Banana 2) | 1K, 2K | $0.134 both |
| `gemini-2.5-flash-image` | 2.5 Flash Image | 1K only | $0.039 |

- `DEFAULT_MODEL_ID = "gemini-3-pro-image"`, `DEFAULT_SIZE = "1K"` (route-level
  fallback only).
- **`STAGE_CONFIG`** is the real per-stage source of truth:
  - `base: 3.1-flash · 1K` — built once; Flash chosen as default because
    **Pro 503s too often** to be the default (switchable to Pro in the UI when
    you want its stronger transfer).
  - `apply: 3.1-flash · 1K` — the repeated try-on, cheap.
  - `finalize: 3-pro · 1K` — a planned re-run of a chosen result (Phase 2,
    **not in the UI yet**).
- Helpers: `getModel`, `resolveSize` (degrades a requested size to one the model
  supports), `costFor`.

> ⚠️ **Stale comments to ignore:** some comments in `HairstyleTester.tsx` (and
> `models.ts`) still say the base defaults to "Pro · 2K". The runtime truth is
> `STAGE_CONFIG` = **Flash · 1K** for base. The `.env.local.example` likewise
> references an old `/api/apply-style` route and a `gemini-2.5-flash-image`
> default — also stale. Trust the code, not those notes.

In the UI: **both stage models are user-overridable** via two `<select>`s; the
**resolutions stay pinned** by `STAGE_CONFIG`.

## 7. The turnaround mechanism (the clever bit)

The base prompt instructs the model to return **one image** that is a 2×2 grid
of the same person:

```
TOP-LEFT  = FRONT      TOP-RIGHT    = LEFT profile (90°)
BOTTOM-LEFT = BACK     BOTTOM-RIGHT = RIGHT profile (90°)
```

The file is **never sliced**. To show a single angle, the UI renders a `div`
whose background is that one image at `background-size: 200% 200%` and positions
it to the matching quarter via `QUARTER_POS`:

```ts
QUARTER_POS = { front:"0% 0%", left:"100% 0%", back:"0% 100%", right:"100% 100%" }
quarterStyle(url, o) → {backgroundImage, backgroundSize:"200% 200%", backgroundPosition: QUARTER_POS[o], no-repeat}
```

A `Segmented` Front/Left/Back/Right toggle (`orientation` state) switches
quarters — instant and free. Used in three places: the active base preview, the
compare slider, and the "exploded" cells.

## 8. Result views

- **Compare** (default): `BeforeAfterSlider` — a QOVES-style swipe reveal. Same
  3:4 box, `beforeUrl` (base, current hair) underneath, `afterUrl` (styled) on
  top **masked with `clip-path: inset(0 {100-pct}% 0 0)`** so the top image is
  never resized → the seam stays pixel-aligned. One `pct` (0–100) drives clip +
  divider + handle. Pointer Events (mouse+touch one path), arrow-key support,
  one-time "drag to compare" hint. Labelled **Before / Projection**.
- **Exploded:** a 3-column `Base | Hair ref | Output` breakdown (the original
  view).

Both views honour the current `orientation` quarter.

## 9. History (`lib/history.ts`) — on-device only

- **IndexedDB** (not localStorage — a 2K result is multi-MB base64 and would
  blow the ~5MB quota). DB `hairstyle-tester`, store `generations`, keyPath `id`.
- `GenerationRecord`: `{id, createdAt, imageUrl, modelId, modelLabel, size, tee,
  prompt, kind:"base"|"styled"}`.
- Capped at `MAX_RECORDS = 24`; on quota error it prunes oldest and retries once.
- **Every helper degrades silently** — a storage failure can never break
  generation.
- On mount, the component loads history and **re-activates the most recent
  `kind:"base"`** record so the frozen customer survives a reload.
- Cost readout: each card shows model · size · cost; a "Total spent" line sums
  all records in **USD and MYR** (`USD_TO_MYR = 4.7`, a static estimate
  constant).

## 10. The prompts (live in `HairstyleTester.tsx`)

- **`DEFAULT_BASE_PROMPT`** — long, strict. Three rules: (1) **identity lock**
  (reproduce the exact face/skull/asymmetry, add no blemishes, don't beautify),
  (2) **keep the customer's own current hair** across all four views, (3) **four
  views in one 2×2 image** in the exact quarter order. Plus detailed **framing**
  (pulled-back 85–105mm look, headroom, shoulders visible, head ~top 40%) and
  **layout** rules (equal quarters, no labels/borders). Contains a `{TEE}`
  placeholder filled per generation with black/white via `composePrompt`.
- **`DEFAULT_APPLY_PROMPT`** — a "skilled barber" 3-step: READ the customer's
  proportions → IDENTIFY the reference cut as a recipe (ignore the reference
  person) → ADAPT and apply, growing hair from the customer's own hairline, then
  keep everything but the hair pixel-identical.
- Both are **editable in the UI** (collapsible `PromptEditor`, with "Reset to
  default").

> ⚠️ **Known mismatch:** `DEFAULT_APPLY_PROMPT` is **not turnaround-aware** — it
> talks about "Image 1 is a studio headshot" as if it were a single front view.
> When applied to a 2×2 base, the styling won't carry consistently across all
> four quarters. This is a known open issue (see §13).

## 11. Dormant Supabase auth

All present but inert until `NEXT_PUBLIC_SUPABASE_URL` + `ANON_KEY` exist:

- `lib/env.ts` exposes `isConfigured`. Every Supabase path early-returns when
  false.
- `Header.tsx` shows the user email + sign-out, or a "Sign in" link.
- `login/page.tsx` sends a magic-link OTP (`signInWithOtp`).
- `middleware.ts` → `updateSession` refreshes the session cookie on real
  navigations (matcher excludes static assets/images).
- Intent (per `.env.local.example`): staff sign-in to manage a catalogue;
  customers browse without an account. **None of this affects the tester today.**

## 12. Misc config

- `next.config.ts`: pins `outputFileTracingRoot` to the project (a stray
  home-dir lockfile would otherwise confuse Next); whitelists remote image hosts
  (`*.supabase.co`, picsum, unsplash) for a future catalogue.
- `layout.tsx`: metadata "AI Hairstyle Test", dark theme color, `max-w-5xl` main
  column, sticky `<Header/>`.
- `globals.css`: Tailwind v4 + a "quiet luxury" gold palette/animations
  earmarked for a future `/studio` flow — **the tester doesn't use them**.

## 13. Known limitations & pending decisions

1. **Transparency / background cutout — model-direct transparency is PROVEN
   impossible.** A decision is pending between two paths:
   - **(a) No-dependency color-key:** prompt the model to paint a flat keyable
     backdrop, then strip that known color in-browser with canvas. Weakness:
     blond/silver hair edges spill/halo.
   - **(b) ML cutout (recommended):** add a segmentation/matting library behind
     a swappable `cutout()` boundary — start with **MediaPipe (Apache-2.0)** for
     a safe/fast baseline, upgradeable to **BiRefNet (MIT)** for better hair
     edges.
   - After a cutout exists: copy `Background.svg` → `public/`, render it as the
     viewer backdrop behind the cropped cutout (base preview, compare slider,
     exploded cells). *(`Background.svg` is a 2615×3299 grey card with a subtle
     linear-gradient overlay baked into an SVG filter.)* **No engine is chosen
     yet** — do not start implementing until the user picks (a) or (b).
2. **Apply prompt isn't turnaround-aware** (see §10). Plan: once the base
   turnaround is visually validated, *propose* (show first) an updated
   `DEFAULT_APPLY_PROMPT` that styles all four quarters consistently.
3. **Pro model 503s frequently** — why Flash is the default for the base.
4. **Stale comments/examples** (§6) — code is the source of truth.
5. **`finalize` stage** (Pro re-run, optional 2K HD download) is defined in
   `STAGE_CONFIG` but **not surfaced in the UI** (Phase 2).

## 14. Standing conventions (how to work in this repo)

- **Keep the two stages separate** and keep `/api/try-on` **generic** (ordered
  images + prompt; meaning lives in the prompt).
- **Supabase stays dormant** intentionally — don't wire it up unless asked.
- **Show any prompt change to the user before implementing it** (standing rule).
- History/cost are **client-side conveniences** — never let them throw into the
  generation flow.
- **Rotate `GEMINI_API_KEY`** once testing is done.
- Roadmap (not started): color profiles, a built-in hairstyle reference
  catalogue, structured hair customizations (length/volume/fade/parting), and a
  proper customer-facing UI.
