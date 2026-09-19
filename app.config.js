const fs = require('fs')
const path = require('path')

/** Local EAS / Xcode: Metro already has .env; store archives do not unless we load it here. */
function applyLocalDotenv() {
  const envPath = path.join(__dirname, '.env')
  if (!fs.existsSync(envPath)) return
  const text = fs.readFileSync(envPath, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

applyLocalDotenv()

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...(config.extra || {}),
    EXPO_PUBLIC_SUPABASE_URL:
      process.env.EXPO_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      config.extra?.EXPO_PUBLIC_SUPABASE_URL ||
      '',
    EXPO_PUBLIC_SUPABASE_ANON_KEY:
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      config.extra?.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
      '',
    /** Admin RPCs are service_role only. Bake from .env / EAS secret — never the learner app. */
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    EXPO_PUBLIC_GEMINI_API_KEY: process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? '',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '',
    EXPO_PUBLIC_VOCAB_BATCH_SECRET:
      process.env.EXPO_PUBLIC_VOCAB_BATCH_SECRET ?? process.env.VOCAB_BATCH_SECRET ?? '',
    VOCAB_BATCH_SECRET:
      process.env.VOCAB_BATCH_SECRET ?? process.env.EXPO_PUBLIC_VOCAB_BATCH_SECRET ?? '',
  },
})
