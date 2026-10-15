/**
 * How much text the learner app can show well. Measured on the learner app (iPhone 16 Pro,
 * plus the 375pt-wide phone math) — see Dubbadhu kineticType.js and CelebrationScreen.js.
 */

/** Audio exposure phrase: one or two big lines up to here. */
export const EXPOSURE_PHRASE_SOFT_MAX = 40
/** Past this the phrase needs 4+ small lines; split it into two words instead. Save is blocked. */
export const EXPOSURE_PHRASE_HARD_MAX = 80
/** Audio exposure meaning: about three lines in the Meaning card. */
export const EXPOSURE_MEANING_SOFT_MAX = 80
/** Celebrate “You learned”: past this the type gets smaller and the list scrolls. */
export const CELEBRATE_LEARNED_SOFT_MAX = 6

export function exposurePhraseWarning(text: string): string | null {
  const n = text.trim().length
  if (n > EXPOSURE_PHRASE_HARD_MAX) {
    return `${n}/${EXPOSURE_PHRASE_HARD_MAX} characters. Too long to show. Split it into two words.`
  }
  if (n > EXPOSURE_PHRASE_SOFT_MAX) {
    return `${n} characters. Shows in small type on phones. Aim for ${EXPOSURE_PHRASE_SOFT_MAX} or fewer.`
  }
  return null
}

export function exposureMeaningWarning(text: string): string | null {
  const n = text.trim().length
  if (n > EXPOSURE_MEANING_SOFT_MAX) {
    return `${n} characters. Learners may need to scroll. Aim for ${EXPOSURE_MEANING_SOFT_MAX} or fewer.`
  }
  return null
}

export function celebrateLearnedWarning(count: number): string | null {
  if (count > CELEBRATE_LEARNED_SOFT_MAX) {
    return `${count} words. Past ${CELEBRATE_LEARNED_SOFT_MAX}, the list shows smaller and scrolls.`
  }
  return null
}
