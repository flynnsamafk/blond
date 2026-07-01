import { NextResponse } from "next/server";

// Vision analysis can take a few seconds and needs Node APIs (Buffer).
export const runtime = "nodejs";
export const maxDuration = 60;

const XAI_BASE = "https://api.x.ai/v1";
const MODEL = "grok-4.3"; // vision-capable (text, image → text)

const PROMPT = `You are a professional salon consultant assessing a customer for a haircut. Using the front and side photos, judge ONLY clearly visible features. Reply with a COMPACT JSON object and nothing else — no commentary, no markdown fences:
{"faceShape":"Oval|Round|Square|Oblong|Heart|Diamond|Triangle","hairline":"Low|Average|High|Receding|Widow's peak|Straight","descent":"the single most-likely ancestry in one or two words, e.g. Anglo, South Asian, East Asian, African, Hispanic, Middle Eastern, Mixed"}`;

async function toDataUrl(blob: Blob): Promise<string> {
  const buf = Buffer.from(await blob.arrayBuffer());
  return `data:${blob.type || "image/jpeg"};base64,${buf.toString("base64")}`;
}

/**
 * Analyse a customer's front + side photos with Grok vision and return real
 * profile attributes (face shape, hairline, descent). Server-only: holds the
 * xAI key, returns `{ attributes }` or `{ error }`.
 */
export async function POST(request: Request) {
  const apiKey = process.env.XAI_API_KEY ?? process.env.GROK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Grok is not configured." }, { status: 501 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const images = form
    .getAll("image")
    .filter((v): v is File => v instanceof Blob && v.size > 0)
    .slice(0, 2);
  if (images.length === 0) {
    return NextResponse.json({ error: "Provide at least one photo." }, { status: 400 });
  }

  const urls = await Promise.all(images.map(toDataUrl));
  const body = JSON.stringify({
    model: MODEL,
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          ...urls.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      },
    ],
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  let res: Response;
  try {
    res = await fetch(`${XAI_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error && err.name === "AbortError"
            ? "Analysis timed out. Try again."
            : "Network error calling Grok.",
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `Analysis failed (${res.status}). ${detail.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
  } | null;
  const text = data?.choices?.[0]?.message?.content ?? "";
  const match = text.match(/\{[\s\S]*\}/); // pull the JSON out even if wrapped
  if (!match) {
    return NextResponse.json({ error: "Could not read the analysis." }, { status: 502 });
  }

  try {
    const p = JSON.parse(match[0]) as Record<string, unknown>;
    return NextResponse.json({
      attributes: {
        faceShape: String(p.faceShape ?? "—"),
        hairline: String(p.hairline ?? "—"),
        descent: String(p.descent ?? "—"),
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not parse the analysis." }, { status: 502 });
  }
}
