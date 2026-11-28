/**
 * Copy the learner app's Vocab sections (Dubbadhu/features/VocabTab/VocabularyData.js) into
 * src/data/vocabSections.json so Admin → Vocab health counts the same words the app shows.
 * Run after the learner app changes its Vocab sections:  npm run sync:vocab-sections
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vocabularyData from '../../Dubbadhu/features/VocabTab/VocabularyData.js'

type Item = { oromo?: string; english?: string }
const out: Record<string, { oromo: string; english: string }[]> = {}
for (const [key, rows] of Object.entries(vocabularyData as Record<string, Item[]>)) {
  out[key] = (rows ?? []).map((r) => ({ oromo: String(r.oromo ?? '').trim(), english: String(r.english ?? '').trim() }))
}
const file = resolve(__dirname, '../src/data/vocabSections.json')
const body = Object.entries(out)
  .map(([key, rows]) => `  ${JSON.stringify(key)}: [\n${rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]`)
  .join(',\n')
writeFileSync(file, `{\n${body}\n}\n`)
console.log(`Wrote ${Object.keys(out).length} sections, ${Object.values(out).flat().length} words → ${file}`)
