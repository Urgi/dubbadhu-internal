/**
 * Known learner A/B tests operated from Internal.
 * v1 is a catalog (not a creation wizard). Flag columns must match prod `app_config`.
 */

export const APP_CONFIG_ROW_ID = 1

/** Prod/staging column (migration `app_config_paywall_free_n_experiment`). */
export const PAYWALL_FREE_N_FLAG_COLUMN = 'paywall_free_n_experiment_enabled' as const
export const TIMED_COMMENTS_FLAG_COLUMN = 'timed_comments_experiment_enabled' as const
export const MIC_SKIP_FLAG_COLUMN = 'mic_skip_experiment_enabled' as const
/** Learner `app_config` column. Off until Internal starts the run. */
export const SPEAKING_TAP_REPS_FLAG_COLUMN = 'speaking_tap_reps_experiment_enabled' as const

export type ExperimentArm = {
  id: string
  label: string
}

export type KnownExperiment = {
  key: string
  title: string
  /** `app_config` boolean this screen starts and stops. */
  flagColumn: string
  arms: ExperimentArm[]
  metric: string
  keep: string
  kill: string
  callAfter: string
}

/** L1 vs L1+L2 free Speak. Hold until activation is stable. */
export const PAYWALL_FREE_N_V1: KnownExperiment = {
  key: 'paywall_free_n_v1',
  title: 'Speak paywall · free N',
  flagColumn: PAYWALL_FREE_N_FLAG_COLUMN,
  arms: [
    { id: 'control_l1_free', label: 'L1 free, then paywall' },
    { id: 'exp_free_l1_l2', label: 'L1+L2 free, then paywall' },
  ],
  metric: 'Premium / exposed · L1–L2 finish must not drop',
  keep: 'Premium up vs L1-free; activation holds',
  kill: 'Activation or paywall-viewed tanks',
  callAfter: 'After comments/skip called · a few hundred activations',
}

export const TIMED_COMMENTS_V1: KnownExperiment = {
  key: 'timed_comments_v1',
  title: 'Series-1 video · timed comments',
  flagColumn: TIMED_COMMENTS_FLAG_COLUMN,
  arms: [
    { id: 'comments_on', label: 'Comments on' },
    { id: 'comments_off', label: 'Comments off' },
  ],
  metric: 'Lesson 1 finish among exposed users',
  keep: 'Comments on ≥ +8 pts vs off',
  kill: 'No lift, or people hide the overlay',
  callAfter: '~400 new users or 3 weeks',
}

export const MIC_SKIP_V1: KnownExperiment = {
  key: 'mic_skip_v1',
  title: 'Speaking · mic skip',
  flagColumn: MIC_SKIP_FLAG_COLUMN,
  arms: [
    { id: 'skip_on', label: 'Skip shown' },
    { id: 'skip_off', label: 'Skip hidden' },
  ],
  metric: 'Lesson 1 finish among exposed users',
  keep: 'Skip hidden holds or raises L1 finish',
  kill: 'Speaking screens drop when Skip is hidden',
  callAfter: 'After comments is called · ~400 new users',
}

/** Mic speaking screen vs tap-reps countdown. Flag stays off until this screen starts it. */
export const SPEAKING_TAP_REPS_V1: KnownExperiment = {
  key: 'speaking_tap_reps_v1',
  title: 'Speaking · tap reps',
  flagColumn: SPEAKING_TAP_REPS_FLAG_COLUMN,
  arms: [
    { id: 'control', label: 'Current mic speaking screen' },
    { id: 'treatment', label: 'Tap-reps countdown' },
  ],
  metric: 'Lesson 1 finish among exposed users',
  keep: 'Tap-reps holds or raises L1 finish vs the mic screen',
  kill: 'L1 finish drops on the tap-reps countdown',
  callAfter: 'After mic skip is called',
}

/** Hub list — add rows here as new flags ship. Do not build a creation wizard. */
export const KNOWN_EXPERIMENTS: KnownExperiment[] = [
  PAYWALL_FREE_N_V1,
  TIMED_COMMENTS_V1,
  MIC_SKIP_V1,
  SPEAKING_TAP_REPS_V1,
]
