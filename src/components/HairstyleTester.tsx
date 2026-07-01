"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { generateImage } from "@/lib/ai/tryOn";
import {
  IMAGE_MODELS,
  STAGE_CONFIG,
  costFor,
  getModel,
  resolveSize,
  type ImageSize,
  type Provider,
} from "@/lib/ai/models";
import {
  MAX_RECORDS,
  addGeneration,
  deleteGeneration,
  listGenerations,
  updateAttributes,
  type GenerationRecord,
} from "@/lib/generations";

type Tee = "black" | "white";
type SlotKey = "front" | "side" | "reference";
type Stage = "base" | "apply" | null;

interface Slot {
  file: File;
  url: string;
}

interface Base {
  id: string;
  url: string;
}

type ResultState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; url: string }
  | { status: "error"; error: string };

// Result presentation: "compare" is the BEFORE/PROJECTION swipe slider (the new
// default); "exploded" is the Base | Hair ref | Output breakdown (the original).
type ResultView = "compare" | "exploded";

// Four-angle turnaround. The base (and, later, a styled result) is ONE generated
// image laid out as a 2×2 grid — front | left over back | right. We never slice
// the file; the UI shows one angle by scaling that image to 200% and positioning
// the background to the matching quarter, so switching angles is instant and free.
type Orientation = "front" | "left" | "back" | "right";

const ORIENTATIONS: { v: Orientation; label: string }[] = [
  { v: "front", label: "Front" },
  { v: "left", label: "Left" },
  { v: "back", label: "Back" },
  { v: "right", label: "Right" },
];

// background-position of each quarter when background-size is 200% 200%.
const QUARTER_POS: Record<Orientation, string> = {
  front: "0% 0%",
  left: "100% 0%",
  back: "0% 100%",
  right: "100% 100%",
};

/** Style that shows just one quarter of a 2×2 turnaround sheet, filling the box. */
function quarterStyle(url: string, o: Orientation): CSSProperties {
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: "200% 200%",
    backgroundPosition: QUARTER_POS[o],
    backgroundRepeat: "no-repeat",
  };
}

// Top-left corner of each quarter as a fraction of the full 2×2 sheet — used by
// the hover magnifier to keep the zoom inside the currently-viewed quarter.
const QUARTER_ORIGIN: Record<Orientation, [number, number]> = {
  front: [0, 0],
  left: [0.5, 0],
  back: [0, 0.5],
  right: [0.5, 0.5],
};

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Amazon-style hover magnifier for the base-profile preview. On hover it shows a
 * lens over the cursor and a floating zoom box (fixed-positioned, so it escapes
 * the card's overflow) that follows the cursor. The zoom is constrained to the
 * currently-viewed quarter of the 2×2 turnaround sheet so it never bleeds into
 * the other angles. Falls back to a plain quarter view when `enabled` is false.
 */
function ZoomPreview({
  url,
  orientation,
  enabled,
}: {
  url: string;
  orientation: Orientation;
  enabled: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [zoom, setZoom] = useState<{
    bgX: number;
    bgY: number;
    lensX: number;
    lensY: number;
    left: number;
    top: number;
  } | null>(null);

  // Quick frosted-glass wipe when the view angle changes, so the angle swap is
  // hidden behind a brief blur instead of the image visibly snapping.
  const [frost, setFrost] = useState(false);
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    setFrost(true);
    const t = setTimeout(() => setFrost(false), 240);
    return () => clearTimeout(t);
  }, [orientation]);

  const SIZE = 4.4; // background-size multiple inside the zoom box (≈2.2× the quarter)
  const BOX_W = 300;
  const BOX_H = 400; // 3:4 to match the preview
  const GAP = 16;
  const lensPct = (2 / SIZE) * 100; // lens edge as % of the preview

  const onMove = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const px = clampN((e.clientX - rect.left) / rect.width, 0, 1);
      const py = clampN((e.clientY - rect.top) / rect.height, 0, 1);
      const [ox, oy] = QUARTER_ORIGIN[orientation];
      const half = 0.5 / SIZE; // half the zoom window, as a fraction of the full sheet
      // Cursor → image point, clamped so the window stays inside this quarter.
      const imgX = clampN(ox + px * 0.5, ox + half, ox + 0.5 - half);
      const imgY = clampN(oy + py * 0.5, oy + half, oy + 0.5 - half);
      const bgX = ((imgX * SIZE - 0.5) / (SIZE - 1)) * 100;
      const bgY = ((imgY * SIZE - 0.5) / (SIZE - 1)) * 100;
      // Place the box to the right of the preview; flip left if it would overflow.
      let left = rect.right + GAP;
      if (left + BOX_W > window.innerWidth - 8) left = rect.left - GAP - BOX_W;
      const top = clampN(rect.top, 8, Math.max(8, window.innerHeight - BOX_H - 8));
      setZoom({
        bgX,
        bgY,
        lensX: ((imgX - ox) / 0.5) * 100,
        lensY: ((imgY - oy) / 0.5) * 100,
        left,
        top,
      });
    },
    [orientation],
  );

  return (
    <div
      ref={ref}
      className={`relative h-full w-full ${enabled ? "cursor-zoom-in" : ""}`}
      onMouseEnter={() => enabled && setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseMove={enabled ? onMove : undefined}
    >
      <div className="h-full w-full transition-all duration-300" style={quarterStyle(url, orientation)} />

      {/* Frosted-glass wipe on angle change */}
      <div
        className={`pointer-events-none absolute inset-0 z-20 bg-white/10 backdrop-blur-md transition-opacity duration-200 ${
          frost ? "opacity-100" : "opacity-0"
        }`}
      />

      {enabled && hover && zoom && !frost && (
        <>
          {/* Lens over the magnified region */}
          <div
            className="pointer-events-none absolute rounded-sm border border-white/80 bg-white/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.12)]"
            style={{
              width: `${lensPct}%`,
              height: `${lensPct}%`,
              left: `${zoom.lensX}%`,
              top: `${zoom.lensY}%`,
              transform: "translate(-50%, -50%)",
            }}
          />
          {/* Floating zoom box (fixed → escapes the card's overflow) */}
          <div
            className="pointer-events-none fixed z-[60] overflow-hidden rounded-xl border-2 border-black bg-white shadow-2xl"
            style={{
              left: zoom.left,
              top: zoom.top,
              width: BOX_W,
              height: BOX_H,
              backgroundImage: `url("${url}")`,
              backgroundSize: `${SIZE * 100}%`,
              backgroundPosition: `${zoom.bgX}% ${zoom.bgY}%`,
              backgroundRepeat: "no-repeat",
            }}
          />
        </>
      )}
    </div>
  );
}

/**
 * "Mystery" generating overlay for the projection. While a profile is being
 * built or regenerated, a frosted-glass gradient pulses over the preview and
 * the customer's angles (front → right → back → left) slowly cycle underneath.
 * When generation finishes the glass fades and drifts off to the top-left,
 * revealing the finished result behind it.
 */
function GenerationGlass({ baseUrl, active }: { baseUrl?: string; active: boolean }) {
  const [phase, setPhase] = useState<"idle" | "in" | "out">("idle");
  const [angle, setAngle] = useState<Orientation>("front");

  useEffect(() => {
    if (active) setPhase("in");
    else setPhase((p) => (p === "in" ? "out" : "idle"));
  }, [active]);

  useEffect(() => {
    if (phase !== "out") return;
    const t = setTimeout(() => setPhase("idle"), 700);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "in") return;
    const seq: Orientation[] = ["front", "right", "back", "left"];
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % seq.length;
      setAngle(seq[i]);
    }, 1100);
    return () => clearInterval(id);
  }, [phase]);

  if (phase === "idle") return null;
  const exiting = phase === "out";

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-30 overflow-hidden transition-all duration-700 ease-out ${
        exiting ? "-translate-x-8 -translate-y-10 scale-90 opacity-0" : "opacity-100"
      }`}
    >
      {/* Customer angles cycling behind the glass (gradient before the first base exists). */}
      {baseUrl ? (
        <div className="absolute inset-0 transition-all duration-700" style={quarterStyle(baseUrl, angle)} />
      ) : (
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#141414,#3a3a3a)]" />
      )}
      {/* Frosted glass + drifting champagne sheen for "mystery". */}
      <div className="absolute inset-0 backdrop-blur-xl" />
      <div
        className="absolute inset-0 mix-blend-overlay opacity-80"
        style={{
          backgroundImage:
            "linear-gradient(115deg, rgba(255,255,255,0.05) 0%, rgba(201,182,143,0.45) 45%, rgba(255,255,255,0.05) 90%)",
          backgroundSize: "250% 100%",
          animation: "studio-shimmer 2.4s linear infinite",
        }}
      />
      <div className="absolute inset-0 bg-white/10" />
      <div className="absolute inset-x-0 bottom-3 text-center">
        <span className="text-[11px] font-semibold tracking-wide text-white/90">
          {baseUrl ? "Regenerating…" : "Building profile…"}
        </span>
      </div>
    </div>
  );
}

// STAGE 1 — build the frozen "customer profile" from front + side. Identity is
// locked here once and the customer's OWN current hair is kept (not restyled).
// Output is a single 2×2 turnaround sheet — front | left over back | right — that
// the UI crops to show one angle at a time. Every hairstyle try reuses this face.
const DEFAULT_BASE_PROMPT = `You are creating the definitive studio turnaround sheet of THIS exact person from the two photos — a faithful "customer profile" reused as the base for trying on hairstyles. It must be the same real individual in every view, never a lookalike or an idealised version.

Image 1 (front) and Image 2 (side) are the customer.

RULE 1 — IDENTITY LOCK (most important). Reproduce the face and head exactly as in Images 1-2, the same in every view. Do NOT redraw, beautify, slim, smooth, symmetrise, re-proportion or age them. Keep identical:
- head and skull shape, head width and overall head size
- face length and proportions, jawline, chin and cheekbones
- forehead height and the customer's own natural hairline shape and position
- the face's natural left/right asymmetry — keep both sides exactly as they differ; never balance or even them out
- eyes (shape, spacing, colour), eyebrows, nose, lips and ears
- the face's three-dimensional depth and contours — the projection of the nose, brow, cheekbones and jaw and the way they model light and shade; keep the real facial depth and bone structure, never flattened, smoothed or softened
- skin tone and complexion — match the customer's EXACT skin colour and undertone from Images 1-2; do not lighten, whiten, darken, tan, warm or cool it, and keep that same true tone consistent in every view (including the shadowed side of the profiles and the back). Reproduce ONLY the moles, freckles or marks clearly visible in Images 1-2, and add none that are not plainly there
- facial hair exactly as in Images 1-2, including its real uneven distribution

SKIN — ADD NOTHING. Keep the skin clean and true to the photos: do not add or invent blemishes, spots, acne, moles, freckles, dark patches, wrinkles, age lines, redness, stray texture or any "dirt" that is not clearly visible in Images 1-2, and do not make the person look older or more tired. At the same time, do not airbrush, over-smooth or beautify them into an idealised or different person — simply render their own skin, looking clean and healthy.

RULE 2 — KEEP THE CUSTOMER'S OWN CURRENT HAIR from Images 1-2 (same cut, length, shape, colour and texture) in every view. Do not restyle it; this base simply shows the customer as they are today. For the views the photos do not show (the back, and the far profile), continue the same haircut plausibly around the head — the same length, density, colour, texture and hairline carried naturally to that angle.

RULE 3 — FOUR VIEWS IN ONE IMAGE (2×2 GRID). Output a SINGLE image divided into four equal quarters, the same person shown from four angles, arranged in this exact order:
- TOP-LEFT — FRONT: facing straight into the lens.
- TOP-RIGHT — LEFT SIDE: the head turned 90° so the subject's LEFT side faces the camera (full profile).
- BOTTOM-LEFT — BACK: the head turned 180°, the back of the head and hair toward the camera.
- BOTTOM-RIGHT — RIGHT SIDE: the head turned 90° the other way so the subject's RIGHT side faces the camera (full profile).

Every quarter must match exactly except for the viewing angle: the same person, the same head size and vertical position, the same crop at the same scale, the same eye-level camera height (lens level with the eyes, no tilt, no high or low angle), the same calm neutral expression, the same plain {TEE} t-shirt, the same smooth neutral studio backdrop (soft light grey / muted blue-grey), the same soft even lighting and true-to-life skin tone.

FRAMING — pulled back and IDENTICAL in all four quarters. Shoot from a fixed distance with the camera set well back, so the face renders at a natural, undistorted scale and is never enlarged or stretched by being too close. Frame every quarter exactly the same — same distance, same subject scale, same crop — so the head is the SAME SIZE in all four views and differs only by its rotation. In each quarter: leave a clear, even band of backdrop above the hair (about one-eighth of the quarter's height) as headroom, in the back view too; place the head — from the top of the hair to the chin — in the upper portion of the quarter so it occupies a little under half the height (about 40%), with the eyes on the upper-third line; and crop at the lower chest so the FULL shoulders and a generous band of upper chest / t-shirt show, with plain backdrop still visible on both sides of the shoulders. Centre the subject horizontally and keep them square to the camera — shoulders level, head untilted — comfortably contained, never filling or crowding the frame.

CAMERA & LENS — emulate a 90mm short-telephoto portrait lens (about 85-105mm full-frame equivalent) at a moderate aperture (around f/8) so the WHOLE head is sharp front to back: the eyes, hairline, ears and the outline of the hair are all crisp and clearly defined. Render a flattering, true-to-life portrait perspective with NO wide-angle distortion, NO face or nose bulge, NO fisheye curvature and NO converging verticals. Keep the backdrop in focus as well — no shallow depth of field, no bokeh, no background blur — and avoid lens vignetting and colour fringing. Keep the lens exactly at eye level in every quarter: straight-on, with no high or low angle and no tilt.

LIGHTING — soft, even, neutral studio lighting, kept IDENTICAL across all four quarters. Use a large, broad, diffused key light with generous fill so the face is lit evenly and gently, with soft open shadows — no hard or hard-edged shadows, no dark or underlit side of the face, no hotspots or blown-out highlights, and no moody, dramatic or high-contrast look. Hold a neutral white balance and true-to-life skin tone with NO colour cast — not warm/orange, not cool/blue, not green. Light the hair fully so its real colour and texture read clearly, and illuminate the BACK and PROFILE views just as evenly as the front so no angle falls into shadow. A subtle, even separation from the backdrop is fine, but keep the whole subject cleanly and consistently exposed — the same brightness and the same light direction in every view. Keep the skin clean and natural throughout — never inventing blemishes, texture or age.

LAYOUT — the four quarters must be exactly equal in size and fill the frame edge-to-edge as a clean 2×2 grid, so the image divides perfectly into four. NO captions, labels, text, numbers, arrows, borders, coloured gridlines or gutters — just the four photographs, each quarter's own studio backdrop continuing cleanly to its edges.

Output only the final image.`;

// COLOUR-ONLY mode — recolour the customer's existing hair to match the
// reference's colour, WITHOUT changing their cut. Used when "Copy colour only".
const COLOR_ONLY_PROMPT = `Image 1 is a FINISHED studio headshot of a salon customer; their identity and HAIRSTYLE are already locked. Image 2 shows a hair COLOUR reference worn by a different person.

Change Image 1 in ONE way only: recolour the customer's hair to match the COLOUR of Image 2 — its base shade, tone, depth and any highlights, lowlights or gradient. Keep the customer's EXISTING haircut, length, shape, parting, fringe, texture, volume and hairline EXACTLY as they are in Image 1 — do NOT restyle or re-cut, change ONLY the colour. Apply the colour naturally from roots to ends with realistic shine, depth and shadow, following the existing hair's flow.

KEEP PIXEL-IDENTICAL to Image 1 except the hair's colour: the face and every feature, the cut and shape of the hair, the hairline, the skin tone, the facial hair, the lighting, the background, the framing and the t-shirt.

Output only the edited image.`;

// STAGE 2 — apply a hairstyle ON TOP of the frozen base. Image 1 is already the
// exact face we want, so the model only repaints the hair. The prompt works like
// a barber: READ the customer's proportions (face shape/size, forehead, hairline,
// ears), IDENTIFY the reference cut as a recipe, then ADAPT it to fit — so it
// looks grown-in, not pasted. Everything but the hair stays pixel-identical.
const DEFAULT_APPLY_PROMPT = `Image 1 is a FINISHED studio headshot of a salon customer; their identity is already locked. Image 2 is a hairstyle reference worn by a DIFFERENT person.

Change Image 1 in ONE way only: replace the hair with the hairstyle from Image 2. But do it the way a skilled barber would — first read the customer's head, then re-cut the reference style to fit THEIR proportions, so the result looks naturally grown and barbered, never pasted or photoshopped on.

STEP 1 — READ THE CUSTOMER (Image 1). Study and respect these proportions; the new hair must be fitted to them:
- Face shape: the overall silhouette (e.g. oval, round, square, oblong, heart, diamond).
- Face size & scale: the width and height of the head within the frame.
- Forehead size & position: the height from eyebrows to the hairline, and where that hairline sits.
- Hairline shape: the customer's own hairline contour, including any recession, widow's peak or cowlicks.
- Ear shape, size & position: how high the ears sit and how far they project — these set where the sideburns, the taper line and the over-ear hair must fall.
- Crown & skull shape: the top and back contour where hair gains height and volume.

STEP 2 — IDENTIFY THE HAIRCUT (Image 2) as a recipe, separate from that person's head. Read off:
- Length zones: length on top, the sides (taper/fade type and how high it climbs), and the back.
- Silhouette: the outline and shape the cut creates.
- Parting & fringe: parting position and direction; fringe presence, direction and length.
- Texture & flow: straight/wavy/curly, the volume, the finish (matte or sheen), and the direction the hair flows.
- Colour: base colour plus any gradient or highlights.
Read ONLY the scalp/head hair — the cut on top, the sides and the back. Do NOT read or copy the reference person's FACIAL HAIR: ignore any beard, moustache or stubble in Image 2 completely. Ignore the reference person entirely — their face, skin, facial hair, ears, head shape and identity are NOT to be copied.

STEP 3 — ADAPT, THEN APPLY to the customer. Re-tailor the Step 2 haircut to the Step 1 proportions:
- Originate the hair from the customer's OWN biological hairline; do not raise or lower where the hair emerges from the scalp. A fringe MAY drape over the forehead, but it must grow from that same hairline.
- Scale the top length, fringe and volume to the customer's forehead height and face size — not the reference person's.
- Balance the silhouette to the customer's face shape while staying true to the reference cut (e.g. a touch more height for a rounder or shorter face; tidier sides for a wider face).
- Align the taper/fade, sideburns and over-ear hair to the customer's actual ear position and shape.
- Follow the customer's natural growth direction, cowlicks and crown so it reads as grown-in.
- Blend the hairline realistically: fine individual hairs at the edge, natural density, soft (not cut-out) edges, correct overlap where hair crosses the forehead and ears, and physically plausible thickness and shadow.
Remove the customer's current hair completely — do not keep their old length, fringe or silhouette.

FACIAL HAIR — change ONLY the scalp hair. Keep the customer's OWN facial hair from Image 1 exactly as it is: the same beard, moustache and stubble, the same coverage, density, shape and real uneven distribution. Copy NONE of the reference person's facial hair, and never add, remove, thicken, thin or reshape the customer's facial hair to match Image 2.

KEEP PIXEL-IDENTICAL to Image 1 (must NOT change): the face and every feature, the skull and head shape, the forehead height and the customer's OWN hairline shape and position, the facial asymmetry, the eyes, nose, lips, and the ears themselves (shape, size, position), the customer's own beard/stubble, the EXACT skin tone and undertone, the skin texture and pores, and the face's three-dimensional depth and contours (the modelling of the nose, brow, cheekbones and jaw), plus the lighting, the background, the framing and the t-shirt. Only the scalp-hair region may differ, and it must integrate seamlessly with the preserved head and grow from the customer's existing hairline. Do not move, re-light, re-frame, beautify, symmetrise, flatten, smooth or re-render the face — preserve its real depth and fine detail. Add no new moles, blemishes, spots, wrinkles, redness or skin texture; do not shift, lighten or darken the skin tone; and do not make the person look older — keep the skin exactly as in Image 1.

Output only the edited image.`;

// Grok's /images/edits endpoint is an EDITOR — it tends to preserve the input
// photo's background, clothing and framing instead of regenerating them like
// Gemini does. These Grok-specific prompts wrap the shared briefs with explicit
// "rebuild the whole scene" (base) / "localised edit only" (apply) directives,
// and are swapped in automatically whenever an xAI model is selected.
const GROK_BASE_PROMPT = `GROK / EDIT-MODEL DIRECTIVE — treat this as a full studio RE-SHOOT, not a light touch-up of the input photos. Actively REBUILD the scene; do not pass the originals through:
- BACKGROUND: discard the original background entirely and replace it with a clean, smooth, evenly-lit neutral LIGHT-GREY studio backdrop, identical behind all four views.
- WARDROBE: render the top as a PLAIN {TEE} t-shirt — remove every logo, print, text, badge or graphic from the original garment.
- REFRAME to a FIXED, CONSISTENT distance — a head-and-shoulders medium portrait, shot from the same set-back position every time. Ignore how near or far the subject was in the input photos: never a tight face close-up, never a distant/small head. In EVERY quarter the head (top of hair to chin) fills about 40% of that quarter's height, sits in the upper third with clear headroom above the hair, and is cropped at the upper chest so both shoulders show. The head must be the SAME SIZE and SAME distance in all four views — differing only by rotation.
- Keep faithful ONLY the person's real identity — face, head shape, hair, facial hair and true skin tone. Everything else must be rebuilt to match this brief.

${DEFAULT_BASE_PROMPT}`;

const GROK_APPLY_PROMPT = `GROK / EDIT-MODEL DIRECTIVE — this is a LOCALISED edit. Change ONLY the scalp-hair pixels; leave every other pixel of Image 1 exactly as it is — the face, the customer's own facial hair, the skin tone, the facial depth, the hairline, the background, the framing and the t-shirt. Do not regenerate, re-light or re-render the face, and do not alter the background or composition.

${DEFAULT_APPLY_PROMPT}`;

/** The default base prompt for a provider — Grok gets its edit-model-tuned variant. */
function baseDefaultPrompt(provider: Provider): string {
  return provider === "xai" ? GROK_BASE_PROMPT : DEFAULT_BASE_PROMPT;
}

/** The default apply prompt for a provider — Grok gets its edit-model-tuned variant. */
function applyDefaultPrompt(provider: Provider): string {
  return provider === "xai" ? GROK_APPLY_PROMPT : DEFAULT_APPLY_PROMPT;
}

// USD → Malaysian Ringgit. Static estimate rate (this is a local cost readout,
// not a billing system) — edit this one number when the rate moves.
const USD_TO_MYR = 4.7;

function composePrompt(template: string, tee: Tee): string {
  return template.split("{TEE}").join(tee);
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Turn a generated data URL back into a Blob so it can be re-sent as an input. */
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function modelShort(label: string): string {
  return label.replace(/^Gemini\s+/i, "").replace(/\s*\(.*\)\s*/, "").trim() || label;
}

/** Cost of a generation in USD, derived from its model + resolution. */
function costUsd(modelId: string, size: ImageSize): number {
  const m = getModel(modelId);
  return m ? costFor(m, size) : 0;
}

/** "$0.13 · RM0.61" — USD first, then Ringgit. */
function costLabel(usd: number): string {
  return `$${usd.toFixed(2)} · RM${(usd * USD_TO_MYR).toFixed(2)}`;
}

export function HairstyleTester() {
  const [slots, setSlots] = useState<Record<SlotKey, Slot | null>>({
    front: null,
    side: null,
    reference: null,
  });
  const [tee, setTee] = useState<Tee>("black");
  // Per-stage tiering: the base is generated once at top quality (default Pro ·
  // 2K); "apply" — the repeated try-on — runs cheap (default Flash · 1K). Both
  // MODELS are user-overridable (e.g. switch the base off Pro when it's 503ing);
  // both stages' RESOLUTIONS stay fixed by STAGE_CONFIG.
  const [baseModelId, setBaseModelId] = useState<string>(STAGE_CONFIG.base.modelId);
  const [applyModelId, setApplyModelId] = useState<string>(STAGE_CONFIG.apply.modelId);
  const [basePrompt, setBasePrompt] = useState(DEFAULT_BASE_PROMPT);
  const [applyPrompt, setApplyPrompt] = useState(DEFAULT_APPLY_PROMPT);
  // Each stage's prompt follows its model's PROVIDER (Gemini vs Grok), swapped
  // by the effects below whenever the selected provider changes.
  const baseProvider: Provider = (getModel(baseModelId) ?? IMAGE_MODELS[0]).provider;
  const applyProvider: Provider = (getModel(applyModelId) ?? IMAGE_MODELS[0]).provider;
  const [base, setBase] = useState<Base | null>(null);
  const [baseError, setBaseError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultState>({ status: "idle" });
  const [stage, setStage] = useState<Stage>(null);
  const [history, setHistory] = useState<GenerationRecord[]>([]);
  const [resultView, setResultView] = useState<ResultView>("compare");
  // Which of the four turnaround angles is currently shown (crops the 2×2 sheet).
  const [orientation, setOrientation] = useState<Orientation>("front");
  // Confirmation gate for regenerating the active profile.
  const [regenAsk, setRegenAsk] = useState(false);
  // Real profile attributes from the Grok vision scan.
  const [attributes, setAttributes] = useState<{
    faceShape: string;
    foreheadShape: string;
    facialRatio: string;
    hairline: string;
  } | null>(null);
  const [attrLoading, setAttrLoading] = useState(false);
  // Customer name attached to the base profile (metadata).
  const [customerName, setCustomerName] = useState("");
  // What to copy from the reference when applying: cut, colour, or both.
  const [copyMode, setCopyMode] = useState<"style" | "color" | "both">("style");
  // TEMP: preview the generating animation without paying for a real generation.
  const [previewGlass, setPreviewGlass] = useState(false);
  // Fit notes carried in from a catalogue style (appended to the apply prompt).
  const [catalogueNotes, setCatalogueNotes] = useState("");

  const busy = stage !== null;
  const tryOnSectionRef = useRef<HTMLDivElement>(null);

  // Revoke preview object URLs on unmount.
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  useEffect(() => {
    return () => {
      Object.values(slotsRef.current).forEach((s) => s && URL.revokeObjectURL(s.url));
    };
  }, []);

  // Load saved generations (IndexedDB, on-device). Re-activate the most recent
  // base profile so the frozen customer survives a page reload.
  useEffect(() => {
    let active = true;
    listGenerations().then((rows) => {
      if (!active) return;
      setHistory(rows);
      const latestBase = rows.find((r) => r.kind === "base");
      if (latestBase) setBase({ id: latestBase.id, url: latestBase.imageUrl });
    });
    return () => {
      active = false;
    };
  }, []);

  // Swap each stage's default prompt when its provider changes (e.g. pick a Grok
  // model → load the Grok-tuned prompt; switch back to Gemini → restore the
  // Gemini one). Switching providers replaces the prompt, discarding edits made
  // under the previous provider; staying within one provider keeps your edits.
  useEffect(() => {
    setBasePrompt(baseDefaultPrompt(baseProvider));
  }, [baseProvider]);
  useEffect(() => {
    setApplyPrompt(applyDefaultPrompt(applyProvider));
  }, [applyProvider]);

  const pick = useCallback((key: SlotKey, file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setSlots((prev) => {
      const old = prev[key];
      if (old) URL.revokeObjectURL(old.url);
      return { ...prev, [key]: { file, url } };
    });
  }, []);

  // Picked a style in the catalogue → preload it as the hair reference and carry
  // its fit notes into the apply prompt. (Handed over via sessionStorage.)
  useEffect(() => {
    const raw = typeof window !== "undefined" ? sessionStorage.getItem("blond:tryOnStyle") : null;
    if (!raw) return;
    sessionStorage.removeItem("blond:tryOnStyle");
    let parsed: { imageUrl: string; name?: string; notes?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    setCatalogueNotes(parsed.notes ?? "");
    (async () => {
      try {
        const res = await fetch(parsed.imageUrl);
        const blob = await res.blob();
        const file = new File([blob], `${parsed.name || "style"}.jpg`, {
          type: blob.type || "image/jpeg",
        });
        pick("reference", file);
        setTimeout(() => tryOnSectionRef.current?.scrollIntoView({ behavior: "smooth" }), 200);
      } catch {
        // ignore — the reference just won't preload
      }
    })();
  }, [pick]);

  // Resolve each stage's tier once. Both models follow their override picker;
  // each stage's RESOLUTION stays pinned by STAGE_CONFIG (base 2K, apply 1K).
  const baseModel = getModel(baseModelId) ?? IMAGE_MODELS[0];
  const baseSize = resolveSize(baseModel, STAGE_CONFIG.base.size);
  const applyModel = getModel(applyModelId) ?? IMAGE_MODELS[0];
  const applySize = resolveSize(applyModel, STAGE_CONFIG.apply.size);
  const totalUsd = history.reduce((sum, r) => sum + costUsd(r.modelId, r.size), 0);

  const canCreateBase = !busy && Boolean(slots.front && slots.side);
  const canApply = !busy && Boolean(base && slots.reference);

  // Records the model + size ACTUALLY used for this generation (passed in by the
  // stage), not a global picker — so every history card's cost is accurate.
  function saveRecord(
    url: string,
    kind: "base" | "styled",
    composed: string,
    usedModelId: string,
    usedSize: ImageSize,
    extra?: { customerName?: string; baseId?: string },
  ): GenerationRecord {
    const usedModel = getModel(usedModelId);
    const record: GenerationRecord = {
      id: makeId(),
      createdAt: Date.now(),
      imageUrl: url,
      modelId: usedModelId,
      modelLabel: usedModel?.label ?? usedModelId,
      size: usedSize,
      tee,
      prompt: composed,
      kind,
      customerName: extra?.customerName,
      baseId: extra?.baseId,
    };
    void addGeneration(record);
    setHistory((prev) => [record, ...prev].slice(0, MAX_RECORDS));
    return record;
  }

  async function createBase() {
    const { front, side } = slots;
    if (!front || !side) return;
    setStage("base");
    setBaseError(null);
    try {
      const composed = composePrompt(basePrompt, tee);
      const url = await generateImage({
        modelId: baseModel.id,
        size: baseSize,
        prompt: composed,
        images: [front.file, side.file],
      });
      const rec = saveRecord(url, "base", composed, baseModel.id, baseSize, {
        customerName: customerName.trim() || undefined,
      });
      setBase({ id: rec.id, url });
      setResult({ status: "idle" });
      void analyzeProfile(front.file, side.file, rec.id);
    } catch (err) {
      setBaseError(err instanceof Error ? err.message : "Failed to build base profile.");
    } finally {
      setStage(null);
    }
  }

  // Real profile attributes via the Grok vision scan (~<1¢). Non-blocking.
  async function analyzeProfile(front: File, side: File, baseId: string) {
    setAttrLoading(true);
    try {
      const fd = new FormData();
      fd.append("image", front);
      fd.append("image", side);
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      const data = (await res.json().catch(() => null)) as
        | {
            attributes?: {
              faceShape: string;
              foreheadShape: string;
              facialRatio: string;
              hairline: string;
            };
          }
        | null;
      if (res.ok && data?.attributes) {
        setAttributes(data.attributes);
        void updateAttributes(baseId, data.attributes);
      }
    } catch {
      // non-fatal — the profile still works without attributes
    } finally {
      setAttrLoading(false);
    }
  }

  // Confirmed regenerate of the active profile (from the U-turn badge).
  function confirmRegenerate() {
    setRegenAsk(false);
    if (!slots.front || !slots.side) {
      setBaseError("Re-upload the front and side photos to regenerate the profile.");
      return;
    }
    void createBase();
  }

  async function applyHairstyle() {
    const { reference } = slots;
    if (!base || !reference) return;
    setStage("apply");
    setResult({ status: "loading" });
    try {
      const baseBlob = await dataUrlToBlob(base.url);
      // Pick what to copy from the reference: cut only, colour only, or both.
      const colourDirective =
        copyMode === "both"
          ? "\n\nHAIR COLOUR: ALSO recolour the hair to match Image 2's colour, tone, depth and any highlights."
          : "\n\nHAIR COLOUR: keep the customer's OWN hair colour from Image 1 unchanged — copy only the cut and shape from Image 2, not its colour.";
      const effectivePrompt =
        copyMode === "color" ? COLOR_ONLY_PROMPT : applyPrompt + colourDirective;
      // Fold in catalogue fit-notes (parting, cowlick, who it suits) if present.
      const finalPrompt = catalogueNotes
        ? `${effectivePrompt}\n\nCATALOGUE STYLE FIT NOTES (adapt the cut to the customer using this): ${catalogueNotes}`
        : effectivePrompt;
      const url = await generateImage({
        modelId: applyModel.id,
        size: applySize,
        prompt: finalPrompt,
        images: [baseBlob, reference.file],
      });
      setResult({ status: "done", url });
      saveRecord(url, "styled", finalPrompt, applyModel.id, applySize, { baseId: base.id });
    } catch (err) {
      setResult({
        status: "error",
        error: err instanceof Error ? err.message : "Failed to apply hairstyle.",
      });
    } finally {
      setStage(null);
    }
  }

  function viewHistory(rec: GenerationRecord) {
    setTee(rec.tee);
    if (rec.kind === "base") {
      setBase({ id: rec.id, url: rec.imageUrl });
      setAttributes(
        rec.attributes
          ? {
              faceShape: rec.attributes.faceShape ?? "—",
              foreheadShape: rec.attributes.foreheadShape ?? "—",
              facialRatio: rec.attributes.facialRatio ?? "—",
              hairline: rec.attributes.hairline ?? "—",
            }
          : null,
      );
      setCustomerName(rec.customerName ?? "");
      setResult({ status: "idle" });
    } else {
      setResult({ status: "done", url: rec.imageUrl });
    }
  }

  async function removeHistory(id: string) {
    setHistory((prev) => prev.filter((r) => r.id !== id));
    if (base?.id === id) setBase(null);
    await deleteGeneration(id);
  }

  const showResult = result.status !== "idle";

  return (
    <div className="space-y-12">
      <header className="space-y-2 pt-6 text-center lg:text-left">
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-none text-black">
          Try Blond
        </h1>
        <p className="text-base sm:text-lg lg:text-xl text-black font-normal">
          First build a <strong className="font-bold">base profile</strong> from a front + side photo
        </p>
        {/* TEMP: preview the generating animation without paying for a real run. Remove later. */}
        <button
          type="button"
          onClick={() => {
            setPreviewGlass(true);
            setTimeout(() => setPreviewGlass(false), 4500);
          }}
          className="mx-auto lg:mx-0 mt-1 inline-block rounded-full border border-dashed border-neutral-300 px-3 py-1 text-xs text-neutral-400 hover:text-neutral-700"
        >
          ▶ Preview animation (temp)
        </button>
      </header>

      {/* STEP 1 — base profile builder */}
      <section className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Upload slots & Build Button */}
          <div className="lg:col-span-5 flex flex-col gap-6 w-full">
            <div className="flex flex-col gap-4 w-full lg:flex-row lg:h-[300px]">
              <div className="w-full h-32 lg:w-1/2 lg:h-full">
                <UploadSlot
                  title="Front"
                  subtitle="Profile"
                  slot={slots.front}
                  onPick={(f) => pick("front", f)}
                  theme="dark"
                />
              </div>
              <div className="w-full h-32 lg:w-1/2 lg:h-full">
                <UploadSlot
                  title="Side"
                  subtitle="Profile"
                  slot={slots.side}
                  onPick={(f) => pick("side", f)}
                  theme="dark"
                />
              </div>
            </div>
            <div className="flex flex-col items-center gap-3 lg:items-start">
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Customer name (optional)"
                className="w-full max-w-xs rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition-colors focus:border-black"
              />
              <button
                type="button"
                onClick={createBase}
                disabled={!canCreateBase}
                className="cursor-pointer bg-[#2B2B2B] text-white rounded-full px-10 py-3 text-base font-semibold hover:bg-[#363636] active:scale-95 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {stage === "base" ? "Building base…" : base ? "Rebuild base profile" : "Build Profile"}
              </button>
              {baseError && <p className="text-xs text-red-600 font-medium">{baseError}</p>}
            </div>
          </div>

          {/* Right Column: Active Profile Card */}
          <div className="lg:col-span-7 w-full">
            <div className="relative bg-white border-2 border-black rounded-xl p-6 flex flex-col lg:flex-row gap-6 items-start">
              {/* Preview & Orientation toggle (on top on mobile, left on desktop) */}
              <div className="w-full max-w-xs mx-auto lg:mx-0 lg:max-w-none lg:w-48 shrink-0 flex flex-col items-center">
                <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-[linear-gradient(180deg,#121212_57.21%,rgba(120,120,120,0.79)_100%)] flex items-center justify-center">
                  {base ? (
                    <ZoomPreview url={base.url} orientation={orientation} enabled />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-4 text-center text-white/55">
                      <span className="text-sm font-semibold">No profile yet</span>
                      <span className="text-xs">Add a front &amp; side photo, then build.</span>
                    </div>
                  )}
                  {/* Mystery generating overlay; fades off to reveal the result. */}
                  <GenerationGlass baseUrl={base?.url} active={stage === "base" || previewGlass} />
                </div>

                <Segmented
                  value={orientation}
                  onChange={setOrientation}
                  options={ORIENTATIONS}
                  disabled={false}
                  variant="profile"
                />
              </div>

              {/* Right Side: Attributes */}
              <div className="flex-1 flex flex-col justify-between self-stretch py-1">
                <div className="space-y-4">
                  <span className="block text-2xl font-semibold text-[#D9D9D9]">Active Profile</span>

                  <div className="space-y-2 pt-1 text-sm sm:text-base">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[#8B8B8B] font-semibold">Face Shape:</span>
                      <span className="text-[#8B8B8B] font-semibold">
                        {attrLoading ? "Analysing…" : (attributes?.faceShape ?? "—")}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[#8B8B8B] font-semibold">Forehead:</span>
                      <span className="text-[#8B8B8B] font-semibold">
                        {attrLoading ? "…" : (attributes?.foreheadShape ?? "—")}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[#8B8B8B] font-semibold">Feature Ratio:</span>
                      <span className="text-[#8B8B8B] font-semibold">
                        {attrLoading ? "…" : (attributes?.facialRatio ?? "—")}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[#8B8B8B] font-semibold">Hairline:</span>
                      <span className="text-[#8B8B8B] font-semibold">
                        {attrLoading ? "…" : (attributes?.hairline ?? "—")}
                      </span>
                    </div>
                  </div>
                </div>

                {base && (
                  <button
                    type="button"
                    onClick={() => {
                      setBase(null);
                      setAttributes(null);
                    }}
                    className="mt-6 text-xs text-neutral-400 hover:text-neutral-600 font-medium underline underline-offset-2 cursor-pointer w-fit"
                  >
                    Clear Profile
                  </button>
                )}
              </div>

              {/* Regenerate the profile (the U-turn badge). Confirms first. */}
              {base && (
                <button
                  type="button"
                  onClick={() => setRegenAsk(true)}
                  disabled={busy}
                  aria-label="Regenerate profile"
                  title="Regenerate profile"
                  className="absolute bottom-4 right-4 rounded-full p-1.5 transition-transform hover:scale-110 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/image-5.png" alt="" aria-hidden className="h-12 w-12 object-contain" />
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Centered Try Blond Button (nudged further down for breathing room) */}
      <div className="flex justify-center pt-10 lg:pt-4 mt-6 lg:mt-0 pb-6 border-b border-neutral-100">
        <button
          type="button"
          onClick={() => {
            tryOnSectionRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
          className="cursor-pointer bg-[#2B2B2B] text-white rounded-full px-16 py-4 text-lg font-bold hover:bg-[#363636] active:scale-95 transition-all duration-200 shadow-md"
        >
          Try Blond
        </button>
      </div>

      {/* STEP 2 — apply hairstyle */}
      <section 
        ref={tryOnSectionRef} 
        className={`space-y-4 pt-6 transition-opacity duration-300 scroll-mt-24 ${!base ? "opacity-50" : ""}`}
      >
        <StepHeading
          n={2}
          title="Try a hairstyle"
          desc="Only the hair changes; the frozen face stays identical. Try as many as you like."
        />
        <div className={`grid grid-cols-2 gap-4 sm:max-w-md h-[280px] md:h-[300px] ${!base ? "pointer-events-none" : ""}`}>
          <UploadSlot
            title="Hair"
            subtitle="Reference"
            slot={slots.reference}
            onPick={(f) => {
              pick("reference", f);
              setCatalogueNotes(""); // manual upload → drop any catalogue notes
            }}
            theme="dark"
          />
        </div>
        <div className="max-w-md space-y-1.5">
          <span className="block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Copy from reference
          </span>
          <Segmented
            value={copyMode}
            onChange={setCopyMode}
            options={[
              { v: "style", label: "Cut only" },
              { v: "color", label: "Colour only" },
              { v: "both", label: "Cut + colour" },
            ]}
          />
        </div>
        <div className="space-y-2">
          <button
            type="button"
            onClick={applyHairstyle}
            disabled={!canApply}
            className="cursor-pointer w-full rounded-lg bg-[#262626] px-4 py-3 text-sm font-medium text-white hover:bg-[#363636] active:scale-95 transition-all duration-200 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 sm:w-auto"
          >
            {stage === "apply" ? "Applying…" : "Apply hairstyle"}
          </button>
          <p className="text-xs text-neutral-500">
            {!base
              ? "Create a base profile first."
              : slots.reference
                ? `One generation with ${modelShort(applyModel.label)} at ${applySize} (~${costLabel(costFor(applyModel, applySize))}). 10–20s.`
                : "Add a reference hairstyle to apply."}
          </p>
        </div>
      </section>

      {/* Per-stage model tiers (Phase 1) */}
      <section className="space-y-4 border-t border-neutral-100 pt-6">
        <div className="space-y-1.5">
          <span className="block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Base model{" "}
            <span className="text-neutral-400">(built once — switch off Pro if it 503s)</span>
          </span>
          <select
            value={baseModelId}
            onChange={(e) => setBaseModelId(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 sm:w-auto sm:min-w-96"
          >
            {IMAGE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="max-w-prose text-xs text-neutral-500">{baseModel.note}</p>
        </div>

        <div className="space-y-1.5">
          <span className="block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Apply model <span className="text-neutral-400">(trying — A/B Flash vs Pro)</span>
          </span>
          <select
            value={applyModelId}
            onChange={(e) => setApplyModelId(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 sm:w-auto sm:min-w-96"
          >
            {IMAGE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="max-w-prose text-xs text-neutral-500">{applyModel.note}</p>
        </div>

        <dl className="flex flex-wrap gap-x-10 gap-y-3 text-xs">
          <div className="space-y-0.5">
            <dt className="font-medium uppercase tracking-wide text-neutral-500">
              Base profile <span className="text-neutral-400">(built once)</span>
            </dt>
            <dd className="text-neutral-700">
              {modelShort(baseModel.label)} · {baseSize} ·{" "}
              {costLabel(costFor(baseModel, baseSize))}
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="font-medium uppercase tracking-wide text-neutral-500">Apply (trying)</dt>
            <dd className="text-neutral-700">
              {modelShort(applyModel.label)} · {applySize} ·{" "}
              {costLabel(costFor(applyModel, applySize))}
            </dd>
          </div>
        </dl>

        <div className="space-y-1.5">
          <span className="block text-xs font-medium uppercase tracking-wide text-neutral-500">
            T-shirt <span className="text-neutral-400">(base profile)</span>
          </span>
          <Segmented
            value={tee}
            onChange={setTee}
            options={[
              { v: "black", label: "Black" },
              { v: "white", label: "White" },
            ]}
          />
        </div>
      </section>

      {/* Editable prompts */}
      <section className="space-y-4">
        <PromptEditor
          label="base prompt"
          value={basePrompt}
          onChange={setBasePrompt}
          onReset={() => setBasePrompt(baseDefaultPrompt(baseProvider))}
          hasTee
        />
        <PromptEditor
          label="apply-hairstyle prompt"
          value={applyPrompt}
          onChange={setApplyPrompt}
          onReset={() => setApplyPrompt(applyDefaultPrompt(applyProvider))}
        />
      </section>

      {/* Result */}
      {showResult && (
        <section className="space-y-3 rounded-xl border border-neutral-200 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Result</span>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {base && result.status === "done" && (
                <Segmented value={orientation} onChange={setOrientation} options={ORIENTATIONS} />
              )}
              {base && result.status === "done" && (
                <Segmented
                  value={resultView}
                  onChange={setResultView}
                  options={[
                    { v: "compare", label: "Compare" },
                    { v: "exploded", label: "Exploded" },
                  ]}
                />
              )}
              {result.status === "done" && (
                <a
                  href={result.url}
                  download="customer-profile.png"
                  className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-800"
                >
                  Download
                </a>
              )}
            </div>
          </div>

          {base && result.status === "done" && resultView === "compare" ? (
            <div className="space-y-2">
              <div className="mx-auto w-full max-w-sm">
                <BeforeAfterSlider beforeUrl={base.url} afterUrl={result.url} orientation={orientation} />
              </div>
              <p className="text-center text-xs text-neutral-500">
                Drag the divider to wipe between the customer&apos;s current hair
                (<strong className="font-medium text-neutral-600">Before</strong>) and the generated
                style (<strong className="font-medium text-neutral-600">Projection</strong>).
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <Frame label="Base">
                {base ? (
                  <div className="h-full w-full" style={quarterStyle(base.url, orientation)} />
                ) : (
                  <Empty>—</Empty>
                )}
              </Frame>
              <Frame label="Hair ref">
                {slots.reference ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slots.reference.url} alt="Hair reference" className="h-full w-full object-cover" />
                ) : (
                  <Empty>—</Empty>
                )}
              </Frame>
              <Frame label="Output">
                {result.status === "done" ? (
                  <div className="h-full w-full" style={quarterStyle(result.url, orientation)} />
                ) : result.status === "loading" ? (
                  <Empty>Applying…</Empty>
                ) : result.status === "error" ? (
                  <Empty tone="error">{result.error}</Empty>
                ) : (
                  <Empty>—</Empty>
                )}
              </Frame>
            </div>
          )}
        </section>
      )}

      {/* History */}
      {history.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              History <span className="text-neutral-400">({history.length})</span>
            </span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-1.5 rounded-lg bg-neutral-50 px-3 py-2 text-xs">
            <span className="text-neutral-500">Total spent</span>
            <span className="font-semibold text-neutral-900">${totalUsd.toFixed(2)}</span>
            <span className="text-neutral-300">·</span>
            <span className="font-semibold text-neutral-900">RM{(totalUsd * USD_TO_MYR).toFixed(2)}</span>
            <span className="text-neutral-400">
              over {history.length} generation{history.length === 1 ? "" : "s"} · est. at RM
              {USD_TO_MYR.toFixed(2)}/USD
            </span>
          </div>
          <p className="text-xs text-neutral-500">
            Saved on this device only (not uploaded). Click a <strong className="font-medium">Base</strong>{" "}
            to make it the active profile, or a <strong className="font-medium">Styled</strong> result to
            reload it.
          </p>
          <ul className="flex gap-3 overflow-x-auto pb-2">
            {history.map((rec) => {
              const isBase = rec.kind === "base";
              const active = base?.id === rec.id;
              return (
                <li key={rec.id} className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => viewHistory(rec)}
                    title={rec.prompt}
                    className={`block w-24 overflow-hidden rounded-lg border hover:border-neutral-400 ${
                      active ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200"
                    }`}
                  >
                    <span className="relative block aspect-[3/4] w-full bg-neutral-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={rec.imageUrl}
                        alt="Saved result"
                        className="h-full w-full object-cover"
                      />
                      <span
                        className={`absolute left-1 top-1 rounded px-1 py-0.5 text-[9px] font-medium text-white ${
                          isBase ? "bg-neutral-900" : "bg-neutral-500/90"
                        }`}
                      >
                        {isBase ? "Base" : "Styled"}
                      </span>
                    </span>
                    <span className="block px-1.5 py-1 text-left">
                      <span className="block truncate text-[10px] font-medium text-neutral-700">
                        {modelShort(rec.modelLabel)}
                      </span>
                      <span className="block text-[10px] text-neutral-400">
                        {rec.size} · {timeAgo(rec.createdAt)}
                      </span>
                      <span className="block text-[10px] font-medium text-neutral-500">
                        {costLabel(costUsd(rec.modelId, rec.size))}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeHistory(rec.id)}
                    aria-label="Delete from history"
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-sm leading-none text-neutral-500 shadow-sm hover:text-red-600"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Regenerate confirmation */}
      {regenAsk && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
          onClick={() => setRegenAsk(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs rounded-2xl border border-neutral-200 bg-white p-5 text-center shadow-xl"
          >
            <h3 className="text-base font-bold text-neutral-900">Regenerate profile?</h3>
            <p className="mt-1.5 text-sm text-neutral-500">
              This rebuilds the base profile from the customer&apos;s photos. The current one will be
              replaced.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setRegenAsk(false)}
                className="flex-1 rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRegenerate}
                className="flex-1 rounded-full bg-[#2B2B2B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3a3a3a]"
              >
                Regenerate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StepHeading({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white">
        {n}
      </span>
      <div className="space-y-0.5">
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        <p className="max-w-prose text-xs text-neutral-500">{desc}</p>
      </div>
    </div>
  );
}

function PromptEditor({
  label,
  value,
  onChange,
  onReset,
  hasTee,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onReset: () => void;
  hasTee?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="text-sm font-medium text-neutral-700 underline underline-offset-2 hover:text-neutral-900"
      >
        {open ? `Hide ${label}` : `Edit ${label}`}
      </button>
      {open && (
        <div className="space-y-2">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full rounded-lg border border-neutral-300 p-3 font-mono text-xs leading-relaxed text-neutral-800"
          />
          <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
            <button
              type="button"
              onClick={onReset}
              className="underline underline-offset-2 hover:text-neutral-800"
            >
              Reset to default
            </button>
            {hasTee && (
              <span>
                <code className="rounded bg-neutral-100 px-1">{"{TEE}"}</code> is filled in per
                generation.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UploadSlot({
  title,
  subtitle,
  slot,
  onPick,
  theme = "dark",
}: {
  title: string;
  subtitle: string;
  slot: Slot | null;
  onPick: (file: File | undefined) => void;
  theme?: "dark" | "light";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  
  const isDark = theme === "dark";
  // Spec: black → grey horizontal gradient card.
  const bgClass = isDark
    ? "bg-[linear-gradient(90deg,#000000_42.31%,#737373_100%)]"
    : "bg-neutral-50 border border-neutral-200";
  const textClass = isDark ? "text-white" : "text-neutral-900";
  const subtextClass = isDark ? "text-neutral-200" : "text-neutral-500";
  
  return (
    <div className={`relative w-full h-full overflow-hidden ${bgClass} ${textClass} flex flex-row items-center justify-between lg:flex-col lg:items-stretch lg:justify-between p-5 select-none shadow-md rounded-none`}>
      {/* Background Preview */}
      {slot && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={slot.url}
            alt={`${title} profile preview`}
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
          />
          <div className="absolute inset-0 bg-black/40 transition-opacity duration-300" />
        </>
      )}

      {/* Labels (left on mobile, top on desktop) */}
      <div className="relative z-10 flex flex-col">
        <span className="text-2xl lg:text-4xl font-extrabold tracking-tight leading-none">{title}</span>
        <span className={`text-sm lg:text-base font-light ${subtextClass} mt-1`}>{subtitle}</span>
      </div>

      {/* Upload pill (right on mobile, centered bottom on desktop) */}
      <div className="relative z-10 flex w-auto shrink-0 justify-end lg:w-full lg:justify-center">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="cursor-pointer bg-[#d9d9d9] lg:bg-white text-black border-2 border-[#797979] rounded-full py-2 px-5 text-xs font-light shadow-md hover:bg-neutral-100 active:scale-95 transition-all duration-200 flex items-center gap-1.5"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            stroke="currentColor"
            className="w-4 h-4"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
            />
          </svg>
          {slot ? "Replace" : "Upload Image"}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
    </div>
  );
}

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="space-y-1">
      <figcaption className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </figcaption>
      <div className="relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
        {children}
      </div>
    </figure>
  );
}

function Empty({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <span
      className={`px-2 text-center text-xs ${tone === "error" ? "text-red-600" : "text-neutral-400"}`}
    >
      {children}
    </span>
  );
}

/**
 * BEFORE / PROJECTION comparison slider (QOVES-style swipe reveal).
 *
 * Two identically-framed 3:4 portraits stacked in one box: `beforeUrl`
 * (customer's current hair) underneath, `afterUrl` (the generated style) on top.
 * The top image is never resized — only MASKED with clip-path to a width that
 * follows the divider — so the two halves stay pixel-aligned along the seam.
 * One number (`pct`, 0–100) drives the clip, the divider and the handle, and
 * Pointer Events give mouse + touch a single code path.
 */
function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  orientation,
  beforeLabel = "Before",
  afterLabel = "Projection",
}: {
  beforeUrl: string;
  afterUrl: string;
  orientation: Orientation;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const [pct, setPct] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  const moveTo = useCallback((clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = ((clientX - rect.left) / rect.width) * 100;
    setPct(Math.max(0, Math.min(100, next)));
  }, []);

  const onDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
      setShowHint(false);
      moveTo(e.clientX);
    },
    [moveTo],
  );

  const onMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragging) moveTo(e.clientX);
    },
    [dragging, moveTo],
  );

  const onUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  }, []);

  // One-time "drag me" nudge fades on its own if the user never touches it.
  useEffect(() => {
    const t = setTimeout(() => setShowHint(false), 3500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      ref={ref}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="slider"
      aria-label="Before / projection comparison"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setPct((p) => Math.max(0, p - 2));
        if (e.key === "ArrowRight") setPct((p) => Math.min(100, p + 2));
      }}
      className={`relative aspect-[3/4] w-full touch-none select-none overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100 ${
        dragging ? "cursor-grabbing" : "cursor-ew-resize"
      }`}
    >
      {/* BEFORE underneath, full box — one quarter of the turnaround sheet */}
      <div
        aria-label={beforeLabel}
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={quarterStyle(beforeUrl, orientation)}
      />
      {/* PROJECTION on top, same quarter, MASKED to the divider (never resized → pixel-aligned) */}
      <div
        aria-label={afterLabel}
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ ...quarterStyle(afterUrl, orientation), clipPath: `inset(0 ${100 - pct}% 0 0)` }}
      />

      {/* Corner labels — each dims as its own side gets thin */}
      <span
        className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white"
        style={{ opacity: Math.min(1, pct / 18) }}
      >
        {afterLabel}
      </span>
      <span
        className="pointer-events-none absolute right-2 top-2 rounded bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white"
        style={{ opacity: Math.min(1, (100 - pct) / 18) }}
      >
        {beforeLabel}
      </span>

      {/* Divider + handle, both pinned to pct */}
      <div className="pointer-events-none absolute inset-y-0" style={{ left: `${pct}%` }}>
        <div className="absolute inset-y-0 -ml-px w-0.5 bg-white shadow-[0_0_3px_rgba(0,0,0,0.45)]" />
        <div className="absolute left-0 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white bg-white/95 text-neutral-700 shadow-md">
          <span className="text-[11px] leading-none tracking-[-0.15em]">◄►</span>
        </div>
      </div>

      {/* One-time drag hint near the handle */}
      <div
        className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-7 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-medium text-white transition-opacity duration-500 ${
          showHint ? "opacity-100" : "opacity-0"
        }`}
      >
        Drag to compare
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  disabled = false,
  variant = "default",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { v: T; label: string }[];
  disabled?: boolean;
  /** "profile" matches the Active Profile View toggle (dark border + black pill). */
  variant?: "default" | "profile";
}) {
  const isProfile = variant === "profile";
  const container = isProfile
    ? "inline-flex rounded-[14px] border-[3px] border-[#4C4C4C] p-0.5 select-none w-full mt-3"
    : "inline-flex bg-neutral-50 rounded-full border border-neutral-200/80 p-0.5 select-none w-full mt-3";
  const activeClass = isProfile ? "bg-[#070707] text-white rounded-[10px]" : "bg-[#262626] text-white shadow-sm";
  const inactiveClass = isProfile ? "text-[#313131] hover:text-black" : "text-neutral-500 hover:text-neutral-800";
  return (
    <div className={container}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.v)}
          className={`flex-1 text-center py-1.5 text-[10px] font-bold cursor-pointer transition-all duration-200 active:scale-95 ${
            isProfile ? "rounded-[10px]" : "rounded-full"
          } ${
            disabled
              ? "text-neutral-300 cursor-not-allowed"
              : value === o.v
                ? activeClass
                : inactiveClass
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
