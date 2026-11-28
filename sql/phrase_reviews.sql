-- Native-speaker review queue for phrases (Admin → Phrase review in dubbadhu-internal).
-- Applied to prod 2026-11-27 (Urgi: "Yes, create on prod"). Server-only: RLS on, no policies,
-- no anon/authenticated grants; the admin app reads and writes with the service role.
-- Words with words.status = 'pending' are shown live from `words`, not copied here.
create table if not exists public.phrase_reviews (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('blog', 'word', 'lesson')),
  source_ref text not null,          -- e.g. 'docs/blog-drafts/06-afaan-oromo-numbers.md:42' or a words.id
  phrase text not null,
  context text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'fixed')),
  fixed_text text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source, source_ref)
);

alter table public.phrase_reviews enable row level security;
revoke all on public.phrase_reviews from anon, authenticated;
