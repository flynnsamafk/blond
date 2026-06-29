/**
 * Root-to-tip distance field — Phase 2 of the color lab.
 *
 * A color profile paints colors positioned ALONG the hair (root → tip). To do
 * that we need, for every hair pixel, a normalized coordinate `t`:
 *   t = 0 at the ROOT (scalp / hairline) → t = 1 at the ENDS (tips).
 *
 * The robust anchor for the root is the HAIRLINE: the boundary where hair meets
 * skin. From that seed we grow a GEODESIC distance that travels only THROUGH the
 * hair region, so the coordinate follows hair that curves sideways or drapes over
 * a shoulder — straight-line (Euclidean) distance would cut across the face/neck
 * and break. The geodesic distance is then normalized so the longest strands map
 * to ~1.
 *
 * This is the make-or-break step: get a clean root→tip field and Phases 3–5
 * (recolor, gradients, lift) are just painting along it.
 *
 * Everything here is pure CPU math on typed arrays — no network, no model, no
 * dependency on how the masks were produced.
 */

export interface RootFieldInput {
  width: number;
  height: number;
  /** RGBA hair mask (from `segmentHair`); alpha channel = hair confidence. */
  hair: Uint8ClampedArray;
  /** RGBA skin mask (from `segmentHair`); alpha channel = skin confidence. */
  skin: Uint8ClampedArray;
}

export interface RootField {
  /** Per-pixel root→tip coordinate. NaN outside hair, else 0 (root) … 1 (tips). */
  field: Float32Array;
  width: number;
  height: number;
  /** Geodesic distance (in px) that maps to t = 1, i.e. the normalization scale. */
  scale: number;
}

// Chamfer step costs: orthogonal neighbor = 1, diagonal = √2.
const ORTHO = 1;
const DIAG = Math.SQRT2;
const INF = Infinity;
// A mask pixel counts as "present" when its confidence alpha is over ~50%.
const ALPHA_THRESHOLD = 128;

/**
 * Multi-pass raster chamfer distance transform.
 *
 * `dist` must be pre-seeded (0 at sources, INF elsewhere). Each sweep does a
 * forward (top-left→bottom-right) then backward pass, relaxing each passable
 * pixel from its already-scanned neighbors. Distance only flows THROUGH passable
 * pixels, which is what makes it geodesic when `passable` is the hair mask.
 * Repeats until a sweep changes nothing or `maxSweeps` is hit.
 */
function chamfer(
  w: number,
  h: number,
  passable: Uint8Array,
  dist: Float32Array,
  maxSweeps: number,
): void {
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let changed = false;

    // Forward: relax from left, top-left, top, top-right.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!passable[i]) continue;
        let d = dist[i];
        if (x > 0 && passable[i - 1]) {
          const c = dist[i - 1] + ORTHO;
          if (c < d) d = c;
        }
        if (x > 0 && y > 0 && passable[i - w - 1]) {
          const c = dist[i - w - 1] + DIAG;
          if (c < d) d = c;
        }
        if (y > 0 && passable[i - w]) {
          const c = dist[i - w] + ORTHO;
          if (c < d) d = c;
        }
        if (x < w - 1 && y > 0 && passable[i - w + 1]) {
          const c = dist[i - w + 1] + DIAG;
          if (c < d) d = c;
        }
        if (d < dist[i]) {
          dist[i] = d;
          changed = true;
        }
      }
    }

    // Backward: relax from right, bottom-right, bottom, bottom-left.
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (!passable[i]) continue;
        let d = dist[i];
        if (x < w - 1 && passable[i + 1]) {
          const c = dist[i + 1] + ORTHO;
          if (c < d) d = c;
        }
        if (x < w - 1 && y < h - 1 && passable[i + w + 1]) {
          const c = dist[i + w + 1] + DIAG;
          if (c < d) d = c;
        }
        if (y < h - 1 && passable[i + w]) {
          const c = dist[i + w] + ORTHO;
          if (c < d) d = c;
        }
        if (x > 0 && y < h - 1 && passable[i + w - 1]) {
          const c = dist[i + w - 1] + DIAG;
          if (c < d) d = c;
        }
        if (d < dist[i]) {
          dist[i] = d;
          changed = true;
        }
      }
    }

    if (!changed) break;
  }
}

/** 99th-percentile of the finite values (robust max — ignores a few stray outliers). */
function percentile99(values: Float32Array, count: number): number {
  if (count === 0) return 0;
  const sorted = values.subarray(0, count);
  sorted.sort();
  const idx = Math.min(count - 1, Math.floor(0.99 * (count - 1)));
  return sorted[idx];
}

/**
 * Compute the normalized root→tip field for a hair mask.
 *
 * Steps:
 *   1. Binarize hair and skin from their confidence alpha.
 *   2. Unconstrained distance-to-skin, so we can find the hairline band.
 *   3. Pick the SEED (root anchor): hair pixels hugging the skin (the hairline),
 *      growing the band until it's substantial. Fallbacks: closest-to-skin hair,
 *      else the topmost hair rows (anchors the root at the top of the head when
 *      skin detection is weak/absent).
 *   4. Geodesic distance from the seed, constrained to hair.
 *   5. Normalize by the 99th-percentile distance → 0 at root, ~1 at the tips.
 */
export function computeRootField(input: RootFieldInput): RootField {
  const { width: w, height: h } = input;
  const n = w * h;

  // 1. Binarize.
  const hairMask = new Uint8Array(n);
  const allPass = new Uint8Array(n);
  let hairCount = 0;
  let skinCount = 0;
  const distSkin = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    allPass[i] = 1;
    const isHair = input.hair[i * 4 + 3] > ALPHA_THRESHOLD;
    const isSkin = input.skin[i * 4 + 3] > ALPHA_THRESHOLD;
    if (isHair) {
      hairMask[i] = 1;
      hairCount++;
    }
    if (isSkin) {
      skinCount++;
      distSkin[i] = 0; // seed for the unconstrained transform
    } else {
      distSkin[i] = INF;
    }
  }

  const field = new Float32Array(n);
  if (hairCount === 0) {
    field.fill(NaN);
    return { field, width: w, height: h, scale: 1 };
  }

  // 2. Distance-to-skin (unconstrained). Converges in one sweep; allow 2.
  if (skinCount > 0) {
    chamfer(w, h, allPass, distSkin, 2);
  }

  // 3. Seed selection.
  const seedDist = new Float32Array(n).fill(INF);
  let seedCount = 0;
  const addSeed = (i: number) => {
    if (seedDist[i] !== 0) {
      seedDist[i] = 0;
      seedCount++;
    }
  };

  const minDim = Math.min(w, h);
  const r0 = Math.max(2, Math.round(minDim * 0.02));
  const minSeed = Math.max(20, Math.round(hairCount * 0.005));

  // Does the model see skin near the hair at all?
  let minHairToSkin = INF;
  if (skinCount > 0) {
    for (let i = 0; i < n; i++) {
      if (hairMask[i] && distSkin[i] < minHairToSkin) minHairToSkin = distSkin[i];
    }
  }
  const skinUsable = skinCount > 0 && Number.isFinite(minHairToSkin);

  if (skinUsable) {
    // Hairline band: hair pixels within radius R of skin; grow R until substantial.
    let r = r0;
    for (let attempt = 0; attempt < 6; attempt++) {
      seedDist.fill(INF);
      seedCount = 0;
      for (let i = 0; i < n; i++) {
        if (hairMask[i] && distSkin[i] <= r) addSeed(i);
      }
      if (seedCount >= minSeed) break;
      r *= 1.6;
    }
    // Still thin → take the hair pixels closest to skin (guaranteed non-empty).
    if (seedCount < minSeed) {
      const band = minHairToSkin + Math.max(r0, 0.5 * r0);
      seedDist.fill(INF);
      seedCount = 0;
      for (let i = 0; i < n; i++) {
        if (hairMask[i] && distSkin[i] <= band) addSeed(i);
      }
    }
  }

  if (seedCount === 0) {
    // 3b. No usable skin → anchor the root at the topmost hair rows.
    let minY = h;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
      let rowHasHair = false;
      for (let x = 0; x < w; x++) {
        if (hairMask[y * w + x]) {
          rowHasHair = true;
          break;
        }
      }
      if (rowHasHair) {
        if (y < minY) minY = y;
        maxY = y;
      }
    }
    const bandRows = Math.max(1, Math.round((maxY - minY + 1) * 0.03));
    for (let y = minY; y <= minY + bandRows && y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (hairMask[i]) addSeed(i);
      }
    }
  }

  // 4. Geodesic distance from the seed, constrained to hair.
  chamfer(w, h, hairMask, seedDist, 40);

  // 5. Normalize by the 99th-percentile of reachable hair distances.
  const finite = new Float32Array(hairCount);
  let finiteCount = 0;
  for (let i = 0; i < n; i++) {
    if (hairMask[i] && Number.isFinite(seedDist[i])) {
      finite[finiteCount++] = seedDist[i];
    }
  }
  let scale = percentile99(finite, finiteCount);
  if (!(scale > 0)) scale = 1; // all-zero / degenerate → avoid divide-by-zero

  for (let i = 0; i < n; i++) {
    if (!hairMask[i]) {
      field[i] = NaN;
    } else if (!Number.isFinite(seedDist[i])) {
      field[i] = 1; // disconnected hair island — treat as far end (tips)
    } else {
      const t = seedDist[i] / scale;
      field[i] = t < 0 ? 0 : t > 1 ? 1 : t;
    }
  }

  return { field, width: w, height: h, scale };
}
