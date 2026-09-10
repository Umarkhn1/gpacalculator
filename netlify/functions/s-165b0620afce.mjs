// Приватный API статистики. Отдаёт список студентов, которые импортировали оценки.
// Доступ только по ключу: заголовок x-access-key (или x-api-key / Bearer / ?key=).

import { readAll, selfTest, readDiag, personKey } from './_stats-store.mjs'

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

// Один студент — одна строка. Опознаём по фамилии и имени (логина при импорте
// без пароля нет, а ФИО на странице плана — без отчества).
const identity = (r) => personKey(r)

// Одна строка на студента: последние известные данные + счётчик импортов.
export function students(events, users) {
  const byId = new Map()
  const put = (id, row) => {
    const cur = byId.get(id)
    if (!cur) {
      byId.set(id, row)
      return
    }
    // Свежая запись обновляет поля, старая — только дополняет пустые.
    // Вычисленное (≈) не затирает настоящее, а настоящее всегда вытесняет вычисленное.
    const fresher = String(row.last || '') > String(cur.last || '')
    // Полное ФИО (с отчеством) важнее короткого из шапки LMS — берём более длинное.
    const fullest = String(row.full || '').length > String(cur.full || '').length ? row.full : cur.full
    for (const f of FIELDS) {
      if (!row[f]) continue
      const rowGuess = row.derived.includes(f)
      const curGuess = cur.derived.includes(f)
      const take = !cur[f] || (curGuess && !rowGuess) || (fresher && rowGuess === curGuess)
      if (!take) continue
      cur[f] = row[f]
      cur.derived = cur.derived.filter((x) => x !== f)
      if (rowGuess) cur.derived.push(f)
    }
    cur.full = fullest
    cur.imports += row.imports
    if (row.first && (!cur.first || row.first < cur.first)) cur.first = row.first
    if (row.last && (!cur.last || row.last > cur.last)) cur.last = row.last
  }

  // Запись без ФИО и логина не выбрасываем — она идёт своей строкой «Без имени».
  for (const u of users) {
    const id = identity(u) || u.key
    if (!id) continue
    put(id, {
      id,
      ...pick(u),
      derived: [...(u.derived || [])],
      first: u.first || u.ts || '',
      last: u.last || u.ts || '',
      imports: u.imports || 1,
    })
  }
  // События нужны, если сводки по студенту нет (записи прошлых версий).
  if (!users.length) {
    for (const e of events) {
      const id = identity(e) || e.key
      if (!id) continue
      put(id, { id, ...pick(e), derived: [...(e.derived || [])], first: e.ts, last: e.ts, imports: 1 })
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
