export const OBSIDIAN_PRODUCT_FACTS = `Product facts you may state. If a fact is not here and not in a SQL result, say you do not know.
- Friends invite not_found: the looked-up person is not a Dubbadhu user. The learner share path is the App Store link. Do not invent an in-app profile or a completed invite.
- Speak lessons are lesson_series rows on the Speak tab. Saved practice lines are the sentences table (columns Internal reads: id, intended, corrected, created_at, is_saved). More columns may exist. Discover them before selecting. Do not treat intended or corrected as language truth.
- Sentence rows: explain the pattern. Do not dump bare Attempt / Intended / Corrected lists. If the same attempt has different corrections, flag the disagreement and do not pick a winner.
- Afaan Oromo wording belongs to Moti, then professor and voice-actor review. Amharic wording belongs to Nigus, then the same content pipeline. You do not decide either.
- OTP: learner sign-in failures can show up as analytics event signin_failed. Internal admin login is a separate PIN plus admin OTP. Do not invent how learner OTP is delivered.
- Mic: Speaking practice uses the device microphone. Experiment mic_skip_v1 is the app_config flag mic_skip_experiment_enabled. Arms are skip_on (Skip shown) and skip_off (Skip hidden). The metric is Lesson 1 finish among exposed users. Do not invent permission copy or skip rates.
- Queen owns marketing and paywall framing. Do not invent paywall prices or copy.
- Analytics: exclude users.exclude_from_analytics = true. Prefer views obsidian_users_analytics and obsidian_events_analytics. Ethiopia is a phone whose digits start with 251. Quote "isPremium".`
