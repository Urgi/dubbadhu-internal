import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const OBSIDIAN_SQL_MAX_CHARS = 8000
export const OBSIDIAN_SQL_MAX_ROUNDS = 6

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|comment|listen|notify|reindex|cluster|execute|security|pg_sleep|dblink|lo_|pg_read|pg_write|set_config|pg_terminate|pg_reload|load_file|into\s+outfile)\b/i

export const RUN_SQL_TOOL = {
  type: 'function' as const,
  function: {
    name: 'run_sql',
    description:
      'Run one read-only SELECT (or WITH … SELECT) against Dubbadhu Postgres. Use for analytics, users, events, retention, waitlist, lessons. Always filter exclude_from_analytics. Prefer aggregates and LIMIT. Do not mutate data.',
    parameters: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'A single SELECT or WITH query. No INSERT/UPDATE/DELETE/DDL.',
        },
      },
      required: ['sql'],
    },
  },
}

export function assertReadonlySelect(sql: string): string {
  const q = sql.replace(/;+\s*$/g, '').trim()
  if (!q) throw new Error('Empty SQL.')
  if (q.length > OBSIDIAN_SQL_MAX_CHARS) throw new Error('SQL is too long.')
  if (q.includes(';')) throw new Error('One statement only.')
  if (!/^\s*(with|select)\b/i.test(q)) throw new Error('Read-only SELECT/WITH only.')
  if (FORBIDDEN.test(q)) throw new Error('Forbidden keyword in SQL.')
  return q
}

export async function execReadonlySql(
  db: SupabaseClient,
  rawSql: unknown,
): Promise<{ ok: true; row_count: number; rows: unknown[] } | { ok: false; error: string }> {
  try {
    const sql = assertReadonlySelect(typeof rawSql === 'string' ? rawSql : '')
    const { data, error } = await db.rpc('obsidian_exec_readonly_sql', { p_sql: sql })
    if (error) return { ok: false, error: error.message }
    const payload = data as { rows?: unknown[]; row_count?: number } | null
    const rows = Array.isArray(payload?.rows) ? payload.rows : []
    const rowCount = typeof payload?.row_count === 'number' ? payload.row_count : rows.length
    return { ok: true, row_count: rowCount, rows }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'SQL failed.' }
  }
}
