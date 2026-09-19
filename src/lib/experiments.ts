/**
 * Known learner A/B tests operated from Internal.
 * v1 is a catalog (not a creation wizard). Flag columns must match prod `app_config`.
 */

export const APP_CONFIG_ROW_ID = 1

/** Prod/staging column (migration `app_config_paywall_free_n_experiment`). */
export const PAYWALL_FREE_N_FLAG_COLUMN = 'paywall_free_n_experiment_enabled' as const

export type ExperimentArm = {
  id: string
  label: string
}

export type KnownExperiment = {
  key: string
  title: string
  /** Single `app_config` boolean this screen may upsert. */
  flagColumn: typeof PAYWALL_FREE_N_FLAG_COLUMN
  arms: ExperimentArm[]
}

/** L1 vs L1+L2 free Speak. Kill if treatment premium or paywall_viewed collapses. */
export const PAYWALL_FREE_N_V1: KnownExperiment = {
  key: 'paywall_free_n_v1',
  title: 'Speak paywall · free N',
  flagColumn: PAYWALL_FREE_N_FLAG_COLUMN,
  arms: [
    { id: 'control_l1_free', label: 'L1 free, then paywall' },
    { id: 'exp_free_l1_l2', label: 'L1+L2 free, then paywall' },
  ],
}

/** Hub list — add rows here as new flags ship. Do not build a creation wizard. */
export const KNOWN_EXPERIMENTS: KnownExperiment[] = [PAYWALL_FREE_N_V1]
