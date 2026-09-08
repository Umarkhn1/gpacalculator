// Приватный API статистики. Отдаёт список студентов, которые импортировали оценки.
// Доступ только по ключу: заголовок x-access-key (или x-api-key / Bearer / ?key=).

import { readAll, selfTest, readDiag } from './_stats-store.mjs'

const KEY = process.env.STATS_KEY || 'b8c2d85d8639d6be2baa7a3f'

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  },
  body: JSON.stringify(body),
})

function keyFrom(event) {
  const h = event.headers || {}
  const auth = h.authorization || h.Authorization || ''
  return (
    h['x-access-key'] ||
    h['x-api-key'] ||
    (auth.startsWith('Bearer ') ? auth.slice(7) : '') ||
    (event.queryStringParameters || {}).key ||
    ''
  ).trim()
}

// Поля, которые показывает дашборд.
const FIELDS = [
  'login',
  'name',
  'full',
  'group',
  'faculty',
  'specialty',
  'birth',
  'gender',
  'course',
  'curator',
  'eduType',
  'eduLang',
  'gpa',
]

const pick = (src) => {
  const out = {}
  for (const f of FIELDS) out[f] = src[f] ?? ''
  return out
}

// Одна строка на студента: последние известные данные + счётчик импортов.
function students(events, users) {
  const byId = new Map()
  const put = (id, row) => {
    const cur = byId.get(id)
    if (!cur) {
      byId.set(id, row)
      return
    }
    // Пустые значения не затирают уже известные.
    for (const f of FIELDS) if (!cur[f] && row[f]) cur[f] = row[f]
    cur.imports += row.imports
    if (row.first && (!cur.first || row.first < cur.first)) cur.first = row.first
    if (row.last && (!cur.last || row.last > cur.last)) cur.last = row.last
  }

  for (const u of users) {
    const id = u.login || u.full || u.name
    if (!id) continue
    put(id, {
      id,
      ...pick(u),
      first: u.first || u.ts || '',
      last: u.last || u.ts || '',
      imports: u.imports || 1,
    })
  }
  // События нужны, если сводки по студенту нет (записи прошлых версий).
  if (!users.length) {
    for (const e of events) {
      const id = e.login || e.full || e.name
      if (!id) continue
      put(id, { id, ...pick(e), first: e.ts, last: e.ts, imports: 1 })
    }
  }

  return [...byId.values()].sort((a, b) => String(b.last).localeCompare(String(a.last)))
}

export const handler = async (event) => {
  if (keyFrom(event) !== KEY) return json(401, { error: 'Нужен ключ доступа' })

  const url = new URL(event.rawUrl || 'https://x/', 'https://x/')
  const extra = (url.searchParams.get('store') || '').split(',')

  if (url.searchParams.get('diag') === '1') {
    const probe = await selfTest(event)
    const scan = await readAll(event, extra)
    const chunks = await readDiag('info-chunks', event)
    return json(200, {
      diag: probe,
      scanned: scan.scanned || [],
      stores: scan.stores || [],
      infoChunks: chunks || null,
    })
  }

  const { events = [], users = [], error } = await readAll(event, extra)
  const list = students(events, users)

  return json(200, {
    ok: true,
    error: error || null,
    students: list,
    events: url.searchParams.get('raw') === '1' ? events : undefined,
  })
}
