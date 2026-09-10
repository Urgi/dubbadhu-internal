# Architecture — Dubbadhu Internal

**Dubbadhu Internal** is the internal Expo app for curriculum, recordings, and review. It is not the learner-facing Dubbadhu client.

Product name is **Dubbadhu Internal**. GitHub: `Urgi/dubbadhu-internal` (renamed from `Dubbadhu-Voice-Recording`). A local clone folder may still be `Dubbadhu-Voice-Recording` — legacy path only. In-app tiles titled “Voice Recording” refer to the **vocabulary audio workflow**, not the product.

## Runtime

- Expo SDK ~55, React Native, TypeScript
- React Navigation stack in `App.tsx`
- Shared Supabase project with the learner app (`src/lib/supabase.ts`, env via `.env` / `app.config.js`)
- Staff sign-in is PIN + role (`src/context/AuthContext.tsx`); admin also uses email OTP 2FA. This is not the learner auth flow.

## Roles

| Role | Home | Typical work |
| --- | --- | --- |
| `admin` | Admin home hub | Analytics, series/lesson config, audio approval, vocab, moderation, ops |
| `voice` | Voice actor hub | Record vocabulary / Qubee audio; relisten to takes awaiting approval |
| `professor` | Professor home | Lesson/series config (subset of admin curriculum tools) |
| `fidel` | Fidel recorder home | Ge'ez syllable recordings |

## Major surfaces

- **Admin hub** (`src/lib/adminHomeSections.ts`) — Analytics, Asset Management (series config, voice recording, vocab, letters, catalog media), Content Moderation
- **Lesson config** — edits `lesson_series` / `lessons.content` JSON; contract in `docs/admin-lesson-editing-spec.md`
- **Voice recording + review** — `words` (and letter tables) audio capture, upload, admin approval
- **Ops** — users, free access, push, force upgrade, home hero, promo

`Recording` / `Review` screens are lazy-loaded so `expo-av` is not imported at startup.

## Data

Writes that learners must not perform use the service role key in this app only (`SUPABASE_SERVICE_ROLE_KEY` in `.env`). One-off SQL helpers live in `sql/`. Lesson JSON contract and editor kit live in `docs/`.

## Identifiers left unchanged

These are store/build identifiers, not the product name:

- npm package: `dubbadhu-voice-recording`
- Expo slug: `Dubbadhu-Voice-Recording`
- iOS bundle id: `com.urgimeaso.Dubbadhu-Voice-Recording`
