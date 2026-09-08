// Приватный API статистики. Отдаёт всё, что записано об импортах.
// Доступ только по ключу: заголовок x-access-key (или x-api-key / Bearer / ?key=).

import { readAll } from './_stats-store.mjs'

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

const day = (ts) => String(ts || '').slice(0, 10)

function aggregate(events, users) {
  const byUser = new Map()
  for (const u of users) {
    const id = u.login || u.full || u.name || u.key
    byUser.set(id, {
      id,
      login: u.login || '',
      name: u.name || '',
      full: u.full || '',
      group: u.group || '',
      faculty: u.faculty || '',
      gpa: u.gpa ?? null,
      credits: u.credits ?? null,
      subjects: u.subjects ?? null,
      first: u.first || u.ts || '',
      last: u.last || u.ts || '',
      imports: u.imports || 1,
    })
  }
  // События дополняют сводку — на случай, если сводки по студенту нет.
  for (const e of events) {
    const id = e.login || e.full || e.name || e.ip || e.key
    if (!id) continue
    const cur = byUser.get(id)
    if (!cur) {
      byUser.set(id, {
        id,
        login: e.login || '',
        name: e.name || '',
        full: e.full || '',
        group: e.group || '',
        faculty: e.faculty || '',
        gpa: e.gpa ?? null,
        credits: e.credits ?? null,
        subjects: e.subjects ?? null,
        first: e.ts,
        last: e.ts,
        imports: 1,
      })
    } else if (!users.length) {
      cur.imports += 1
      if (e.ts < cur.first) cur.first = e.ts
      if (e.ts > cur.last) cur.last = e.ts
    }
  }

  const daily = {}
  for (const e of events) {
    const d = day(e.ts)
    if (d) daily[d] = (daily[d] || 0) + 1
  }

  const list = [...byUser.values()].sort((a, b) =>
    String(b.last).localeCompare(String(a.last)),
  )
  const gpas = list.map((u) => u.gpa).filter((g) => typeof g === 'number' && g > 0)

  return {
    totals: {
      imports: events.length || list.reduce((n, u) => n + (u.imports || 0), 0),
      students: list.length,
      avgGpa: gpas.length ? +(gpas.reduce((a, b) => a + b, 0) / gpas.length).toFixed(2) : 0,
      today: daily[day(new Date().toISOString())] || 0,
    },
    daily: Object.entries(daily)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count })),
    users: list,
  }
}

export const handler = async (event) => {
  if (keyFrom(event) !== KEY) return json(401, { error: 'Нужен ключ доступа' })

  const { events = [], users = [], stores = [], error } = await readAll(event)
  const agg = aggregate(events, users)
  const url = new URL(event.rawUrl || 'https://x/', 'https://x/')
  const raw = url.searchParams.get('raw') === '1'

  return json(200, {
    ok: true,
    error: error || null,
    stores,
    ...agg,
    events: raw ? events : events.slice(0, 300),
  })
}
