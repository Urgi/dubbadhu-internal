import type { SupabaseClient } from '@supabase/supabase-js'

export type AdminDevicePlatform = 'ios' | 'android' | 'web' | 'unknown'

export type AdminDeviceInfo = {
  platform: AdminDevicePlatform
  appVersion: string | null
}

/** Normalize analytics / push_tokens platform strings. */
export function normalizeDevicePlatform(raw: unknown): AdminDevicePlatform {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (s === 'ios' || s === 'iphone' || s === 'ipad') return 'ios'
  if (s === 'android') return 'android'
  if (s === 'web') return 'web'
  return 'unknown'
}

export function platformLabel(platform: AdminDevicePlatform | null | undefined): string {
  if (platform === 'ios') return 'iOS'
  if (platform === 'android') return 'Android'
  if (platform === 'web') return 'Web'
  return '—'
}

export function readPlatformFromProperties(
  properties: Record<string, unknown> | null | undefined,
): AdminDevicePlatform {
  if (!properties) return 'unknown'
  return normalizeDevicePlatform(properties.platform ?? properties.os)
}

export function readAppVersionFromProperties(
  properties: Record<string, unknown> | null | undefined,
): string | null {
  if (!properties) return null
  for (const key of ['app_version', 'appVersion', 'version']) {
    const v = properties[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

/**
 * Best-effort device info for a cohort: push_tokens first, then newest analytics_events.
 */
export async function fetchDeviceInfoForUserIds(
  client: SupabaseClient,
  userIds: string[],
): Promise<Map<string, AdminDeviceInfo>> {
  const out = new Map<string, AdminDeviceInfo>()
  const ids = [...new Set(userIds.filter(Boolean))].slice(0, 200)
  if (ids.length === 0) return out

  const { data: tokenRows } = await client
    .from('push_tokens')
    .select('user_id, platform')
    .in('user_id', ids)

  for (const row of tokenRows ?? []) {
    const id = String((row as { user_id?: string }).user_id ?? '')
    if (!id || out.has(id)) continue
    const platform = normalizeDevicePlatform((row as { platform?: string }).platform)
    if (platform === 'unknown') continue
    out.set(id, { platform, appVersion: null })
  }

  const missing = ids.filter((id) => !out.has(id) || !out.get(id)?.appVersion)
  if (missing.length === 0) return out

  const { data: eventRows } = await client
    .from('analytics_events')
    .select('user_id, properties, created_at')
    .in('user_id', missing)
    .order('created_at', { ascending: false })
    .limit(Math.min(800, missing.length * 8))

  for (const raw of eventRows ?? []) {
    const id = String((raw as { user_id?: string }).user_id ?? '')
    if (!id) continue
    const props = ((raw as { properties?: Record<string, unknown> | null }).properties ??
      null) as Record<string, unknown> | null
    const platform = readPlatformFromProperties(props)
    const appVersion = readAppVersionFromProperties(props)
    const prev = out.get(id)
    if (!prev) {
      if (platform === 'unknown' && !appVersion) continue
      out.set(id, {
        platform: platform === 'unknown' ? 'unknown' : platform,
        appVersion,
      })
      continue
    }
    if (prev.platform === 'unknown' && platform !== 'unknown') {
      out.set(id, { platform, appVersion: prev.appVersion ?? appVersion })
    } else if (!prev.appVersion && appVersion) {
      out.set(id, { ...prev, appVersion })
    }
  }

  return out
}
