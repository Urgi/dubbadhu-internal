import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { requireAdmin, isAdminCaller, requireEnv } from '../_shared/admin.ts'
import { jsonResponse, optionsResponse } from '../_shared/cors.ts'

// Live MRR for Admin → MRR & burn. Calls RevenueCat API v2 overview metrics
// (GET /v2/projects/{project_id}/metrics/overview, permission charts_metrics:overview:read), then the
// `actives` and `trials` charts split by product duration (permission charts_metrics:charts:read).
// The split is best effort: if it fails, the overview still returns with `breakdownError`.
// The RevenueCat secret key lives only here. Only a signed-in admin user may read: the internal
// app's service role key is in its binary, so a service_role caller is refused (same as crew-decide).

type RcMetric = {
  id?: string
  name?: string
  unit?: string
  period?: string
  value?: number
  last_updated_at_iso8601?: string | null
}

type DurationCount = { label: string; count: number }

type ChartSegment = { display_name?: string; is_total?: boolean; is_other?: boolean }
type ChartPoint = { cohort?: number; measure?: number; segment?: number; value?: number }

const RC_BASE = 'https://api.revenuecat.com/v2'

async function rcGet(path: string, apiKey: string): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`${RC_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  })
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) }
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Latest day's count per product duration (e.g. Monthly / Yearly) for one chart. */
async function countsByDuration(
  projectPath: string,
  chart: 'actives' | 'trials',
  apiKey: string,
): Promise<DurationCount[]> {
  // The segment id isn't documented, so find it in the chart's options.
  const options = await rcGet(`${projectPath}/charts/${chart}/options`, apiKey)
  if (!options.ok) throw new Error(options.body?.message || `${chart} options HTTP ${options.status}`)
  const segments = (options.body?.segments ?? []) as { id?: string; display_name?: string }[]
  const durationSegment = segments.find((s) => /duration/i.test(`${s.id} ${s.display_name}`))
  if (!durationSegment?.id) throw new Error(`No product duration segment on ${chart}.`)

  const end = new Date()
  const start = new Date(end.getTime() - 7 * 86400000)
  const query = new URLSearchParams({
    segment: durationSegment.id,
    resolution: '0',
    start_date: isoDay(start),
    end_date: isoDay(end),
  })
  const data = await rcGet(`${projectPath}/charts/${chart}?${query}`, apiKey)
  if (!data.ok) throw new Error(data.body?.message || `${chart} HTTP ${data.status}`)

  const chartSegments = (data.body?.segments ?? []) as ChartSegment[]
  const points = ((data.body?.values ?? []) as ChartPoint[]).filter(
    (p) => typeof p.cohort === 'number' && typeof p.value === 'number' && (p.measure ?? 0) === 0,
  )
  const latest = Math.max(...points.map((p) => p.cohort as number))
  return points
    .filter((p) => p.cohort === latest && !chartSegments[p.segment ?? 0]?.is_total)
    .map((p) => ({
      label: chartSegments[p.segment ?? 0]?.display_name ?? 'Other',
      count: Math.round(p.value as number),
    }))
    .sort((a, b) => b.count - a.count)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse()
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'POST only' }, 405)
  }

  const admin = await requireAdmin(req)
  if (!isAdminCaller(admin)) return admin
  if (admin.via !== 'user_jwt' || !admin.userId) {
    return jsonResponse({ ok: false, error: 'Sign in again to see RevenueCat numbers.' }, 401)
  }

  const apiKey = requireEnv('REVENUECAT_SECRET_KEY')
  if (apiKey instanceof Response) return apiKey
  const projectId = requireEnv('REVENUECAT_PROJECT_ID')
  if (projectId instanceof Response) return projectId

  const projectPath = `/projects/${encodeURIComponent(projectId)}`
  let res: { ok: boolean; status: number; body: any }
  try {
    res = await rcGet(`${projectPath}/metrics/overview?currency=USD`, apiKey)
  } catch (e) {
    return jsonResponse({ ok: false, error: `RevenueCat unreachable: ${e instanceof Error ? e.message : e}` }, 502)
  }

  const body = res.body as { metrics?: RcMetric[]; currency?: string; message?: string } | null
  if (!res.ok || !body) {
    const detail = body?.message || `HTTP ${res.status}`
    const status = res.status === 429 ? 429 : 502
    return jsonResponse({ ok: false, error: `RevenueCat: ${detail}` }, status)
  }

  let byDuration: { subscriptions: DurationCount[]; trials: DurationCount[] } | null = null
  let breakdownError: string | null = null
  try {
    const [subscriptions, trials] = await Promise.all([
      countsByDuration(projectPath, 'actives', apiKey),
      countsByDuration(projectPath, 'trials', apiKey),
    ])
    byDuration = { subscriptions, trials }
  } catch (e) {
    breakdownError = e instanceof Error ? e.message : String(e)
  }

  const metrics = (body.metrics ?? [])
    .filter((m) => typeof m.id === 'string' && typeof m.value === 'number')
    .map((m) => ({
      id: m.id as string,
      name: m.name ?? m.id,
      unit: m.unit ?? '',
      period: m.period ?? '',
      value: m.value as number,
      updatedAt: m.last_updated_at_iso8601 ?? null,
    }))

  return jsonResponse({ ok: true, currency: body.currency ?? 'USD', metrics, byDuration, breakdownError })
})
