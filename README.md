# Dubbadhu Internal

Internal tooling for Dubbadhu: lesson configuration, voice/letter recordings, storage uploads, and admin/review. This is **not** the learner-facing Dubbadhu app.

**Product name:** Dubbadhu Internal. Do not call this product “admin app” or “Voice-Recording”.

## Repo and paths

- GitHub: [`Urgi/dubbadhu-internal`](https://github.com/Urgi/dubbadhu-internal) (renamed from `Dubbadhu-Voice-Recording`)
- Local clone folder may still be named `Dubbadhu-Voice-Recording` — treat that as a **legacy path only**
- Expo display name in `app.json` is `Dubbadhu Internal`. The Expo slug, npm package name, and iOS bundle identifier still use the legacy `Dubbadhu-Voice-Recording` strings so store/EAS identities stay stable.

## Stack

Expo ~55, React Native, TypeScript. Data lives in the shared Dubbadhu Supabase project.

## Run

```bash
npm install
npx expo start
```

iOS native / EAS notes: [`docs/IOS_LOCAL_BUILD.md`](./docs/IOS_LOCAL_BUILD.md), [`docs/EAS-iOS.md`](./docs/EAS-iOS.md).

## Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md). Agent notes: [`AGENTS.md`](./AGENTS.md).
