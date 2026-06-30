# Blond

Blond is a B2B AI hairstyle try-on tool for salon staff — run in-chair, on a phone, in front of a seated client.

## Realism is the whole point

A try-on only helps a stylist if the client believes it's **them**. So Blond is engineered around identity, not novelty:

- **Lock the person first.** From a front + side photo, Blond builds a frozen _base profile_ — a four-angle turnaround that preserves the exact face shape, skull, hairline, facial hair, skin tone and undertone, and the real three-dimensional depth of the features. No beautifying, no forced symmetry, no idealising.
- **Change only the hair.** Every hairstyle is applied on top of that locked base the way a barber would: the reference cut is re-tailored to the client's proportions and grows from their own hairline. Everything else stays pixel-identical.

Because identity is built once and reused, every style the client tries on looks like the same real person — consistent, grounded, and salon-credible.

## Access

Blond is staff-only. The whole app sits behind a Supabase email/password gate — unauthenticated visitors are sent to `/login`, and the generation API returns `401`. Accounts are created by an admin in Supabase (no public signup).

## Stack & setup

Next.js 15, React 19, Tailwind CSS 4, Supabase Auth, with Google Gemini and xAI Grok image models.

```bash
npm install
npm run dev
```

Then add to `.env.local`:

- `GEMINI_API_KEY` and `XAI_API_KEY` — image generation
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` — staff login gate
