-- Styles catalogue
-- Run in the Supabase SQL editor or via `supabase db push`.

create extension if not exists "pgcrypto";

create table if not exists public.styles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  photo_url   text not null,
  -- tags shape: { "length": "...", "color": "...", "texture": "...", "face_shape": "..." }
  tags        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists styles_created_at_idx on public.styles (created_at desc);
-- GIN index so you can filter by tags later, e.g. tags @> '{"length":"long"}'
create index if not exists styles_tags_idx on public.styles using gin (tags);

-- Row Level Security: catalogue is public to read, staff (authenticated) to write.
alter table public.styles enable row level security;

drop policy if exists "Public can read styles" on public.styles;
create policy "Public can read styles"
  on public.styles for select
  to anon, authenticated
  using (true);

drop policy if exists "Authenticated can insert styles" on public.styles;
create policy "Authenticated can insert styles"
  on public.styles for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated can update styles" on public.styles;
create policy "Authenticated can update styles"
  on public.styles for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated can delete styles" on public.styles;
create policy "Authenticated can delete styles"
  on public.styles for delete
  to authenticated
  using (true);
