/**
 * Put every [CHECK] marker in docs/blog-drafts/*.md into public.phrase_reviews (Admin → Phrase review).
 * Upserts by (source, source_ref) = ('blog', '<file>:<line>'); reviewed rows are left alone.
 * Writes to the Supabase project in .env (prod). Dry run by default; pass --write to insert.
 *   npm run seed:phrase-reviews            # show what would be added
 *   npm run seed:phrase-reviews -- --write # insert new ones
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const DRAFTS = resolve(__dirname, '../../docs/blog-drafts')

export type BlogCheck = { source_ref: string; phrase: string; context: string }

const clean = (s: string) =>
  s
    .replace(/\[CHECK\]/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+([,.])/g, '$1')
    .replace(/^[\s:–-]+|[\s:–-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** The phrase is the table cell (or bold lead-in) holding the marker; context is the whole line. */
export function checksInMarkdown(file: string, text: string): BlogCheck[] {
  const out: BlogCheck[] = []
  text.split('\n').forEach((line, i) => {
    if (!line.includes('[CHECK]')) return
    let phrase = ''
    if (line.trim().startsWith('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean)
      const marked = cells.find((c) => c.includes('[CHECK]')) ?? ''
      phrase = clean(marked)
      // A note column ("no recorded example yet") means little alone: name the row too.
      const first = clean(cells[0] ?? '')
      if (cells[0] !== marked && first) phrase = `${phrase} (${first})`
    } else {
      const bold = line.match(/\*\*([^*]*\[CHECK\][^*]*)\*\*/)
      phrase = clean(bold ? bold[1] : line.replace(/^[-*\s]+/, ''))
    }
    out.push({
      source_ref: `docs/blog-drafts/${file}:${i + 1}`,
      phrase: (phrase || clean(line)).slice(0, 200),
      context: line.replace(/\s+/g, ' ').trim().slice(0, 600),
    })
  })
  return out
}

async function main() {
  const write = process.argv.includes('--write')
  const checks = readdirSync(DRAFTS)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .flatMap((f) => checksInMarkdown(f, readFileSync(resolve(DRAFTS, f), 'utf8')))
  for (const c of checks) console.log(`${c.source_ref}  ${c.phrase}`)
  console.log(`${checks.length} [CHECK] markers`)
  if (!write) {
    console.log('Dry run. Pass --write to insert.')
    return
  }
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Set EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (.env)')
  const client = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await client
    .from('phrase_reviews')
    .upsert(
      checks.map((c) => ({ source: 'blog', ...c })),
      { onConflict: 'source,source_ref', ignoreDuplicates: true },
    )
    .select('id')
  if (error) throw new Error(error.message)
  console.log(`Inserted ${data?.length ?? 0} new row(s).`)
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
