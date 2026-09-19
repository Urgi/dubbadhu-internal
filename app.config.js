const fs = require('fs')
const path = require('path')

/** Local EAS copies the tree without gitignored .env — also try cwd and inherited env. */
function applyLocalDotenv() {
  const candidates = [
    path.join(__dirname, '.env'),
    path.join(process.cwd(), '.env'),
  ]
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue
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
    break
  }
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (serviceRole && !process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY) {
    process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY = serviceRole
  }
}

applyLocalDotenv()

module.exports = ({ config }) => {
  const serviceRole =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY ||
    ''
  if (process.env.EAS_BUILD === 'true' && !serviceRole) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY missing during EAS build. Source Internal .env in the same shell (gitignored files are not copied into the local archive).',
    )
  }

  return {
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
    SUPABASE_SERVICE_ROLE_KEY: serviceRole,
    EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: serviceRole,
    EXPO_PUBLIC_GEMINI_API_KEY: process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? '',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '',
    EXPO_PUBLIC_VOCAB_BATCH_SECRET:
      process.env.EXPO_PUBLIC_VOCAB_BATCH_SECRET ?? process.env.VOCAB_BATCH_SECRET ?? '',
    VOCAB_BATCH_SECRET:
      process.env.VOCAB_BATCH_SECRET ?? process.env.EXPO_PUBLIC_VOCAB_BATCH_SECRET ?? '',
  },
  }
}
