import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Native-speaker review queue (Admin → Phrase review).
 * - Stored reviews: public.phrase_reviews (prod 20261127120000_phrase_reviews.sql; service role only).
 *   Blog [CHECK] markers are seeded with `npm run seed:phrase-reviews -- --write`.
 * - Live words: `words` rows still being worked on (rejected / pending / re-record, or text not approved).
 *   A review of a word is saved as a phrase_reviews row (source 'word', source_ref = words.id);
 *   it never edits `words` — fixes go through Vocab Center / the recording queue.
 */

export type ReviewStatus = 'pending' | 'approved' | 'fixed'
export type ReviewSource = 'blog' | 'word' | 'lesson'

export type ReviewItem = {
  key: string
  source: ReviewSource
  sourceRef: string
  phrase: string
  context: string | null
  status: ReviewStatus
  fixedText: string | null
  reviewedBy: string | null
  reviewedAt: string | null
}

type ReviewRow = {
  source: ReviewSource
  source_ref: string
  phrase: string
  context: string | null
  status: ReviewStatus
  fixed_text: string | null
  reviewed_by: string | null
  reviewed_at: string | null
}

type WordRow = {
  id: string
  word: string | null
  translation: string | null
  series: string | null
  status: string | null
  vocab_text_approved: boolean | null
}

const WORD_STATUSES_TO_CHECK = ['pending', 'rejected', 'rerecord_requested']

function fromRow(r: ReviewRow): ReviewItem {
  return {
    key: `${r.source}:${r.source_ref}`,
    source: r.source,
    sourceRef: r.source_ref,
    phrase: r.phrase,
    context: r.context,
    status: r.status,
    fixedText: r.fixed_text,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
  }
}

export function wordContext(w: WordRow): string {
  const why =
    w.vocab_text_approved === false ? 'text not approved yet' : `recording ${String(w.status ?? 'pending')}`
  return [w.translation && `“${w.translation}”`, w.series && `series ${w.series}`, why].filter(Boolean).join(' · ')
}

/** Pure merge: stored reviews + live words (a stored word review wins over the live row). */
export function mergeReviewQueue(rows: ReviewRow[], words: WordRow[]): ReviewItem[] {
  const items = rows.map(fromRow)
  const stored = new Set(items.map((i) => i.key))
  for (const w of words) {
    const key = `word:${w.id}`
    if (stored.has(key)) continue
    items.push({
      key,
      source: 'word',
      sourceRef: w.id,
      phrase: String(w.word ?? '').trim() || w.id,
      context: wordContext(w),
      status: 'pending',
      fixedText: null,
      reviewedBy: null,
      reviewedAt: null,
    })
  }
  return items.sort((a, b) => a.source.localeCompare(b.source) || a.sourceRef.localeCompare(b.sourceRef, undefined, { numeric: true }))
}

export async function fetchReviewQueue(
  client: SupabaseClient,
): Promise<{ data: ReviewItem[]; error: string | null }> {
  const [reviews, words] = await Promise.all([
    client
      .from('phrase_reviews')
      .select('source, source_ref, phrase, context, status, fixed_text, reviewed_by, reviewed_at')
      .limit(2000),
    client
      .from('words')
      .select('id, word, translation, series, status, vocab_text_approved')
      .or(`status.in.(${WORD_STATUSES_TO_CHECK.join(',')}),vocab_text_approved.eq.false`)
      .limit(1000),
  ])
  if (reviews.error) return { data: [], error: reviews.error.message }
  if (words.error) return { data: [], error: words.error.message }
  return { data: mergeReviewQueue((reviews.data ?? []) as ReviewRow[], (words.data ?? []) as WordRow[]), error: null }
}

export async function saveReview(
  client: SupabaseClient,
  item: ReviewItem,
  next: { status: ReviewStatus; fixedText?: string | null; reviewer: string | null },
): Promise<{ error: string | null }> {
  const reviewed = next.status !== 'pending'
  const { error } = await client.from('phrase_reviews').upsert(
    {
      source: item.source,
      source_ref: item.sourceRef,
      phrase: item.phrase,
      context: item.context,
      status: next.status,
      fixed_text: next.status === 'fixed' ? (next.fixedText ?? '').trim() || null : null,
      reviewed_by: reviewed ? next.reviewer || 'admin' : null,
      reviewed_at: reviewed ? new Date().toISOString() : null,
    },
    { onConflict: 'source,source_ref' },
  )
  return { error: error?.message ?? null }
}
