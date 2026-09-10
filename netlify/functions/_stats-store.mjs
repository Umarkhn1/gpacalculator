// Хранилище статистики импортов на Netlify Blobs.
// Данные живут на стороне сайта и переживают любые деплои, поэтому записи,
// сделанные прошлыми версиями функции, никуда не пропадают.

const STORE = 'gpa-stats'

// Имена хранилищ, которыми пользовались прошлые версии дашборда.
// Читаем из всех, чтобы старые записи снова оказались на странице.
const LEGACY_STORES = ['stats', 'gpa', 'gpa-calculator', 'imports', 'visits', 'users']

let cached = null

async function blobs(event) {
  try {
    if (!cached) cached = await import('@netlify/blobs')
    if (event && cached.connectLambda) {
      try {
        cached.connectLambda(event)
      } catch {}
    }
    return cached
  } catch {
    return null
  }
}

async function store(name = STORE) {
  const mod = await blobs()
  if (!mod) return null
  // Строгая консистентность в этом рантайме недоступна — оставляем обычную.
  try {
    return mod.getStore(name)
  } catch {
    return null
  }
}

const rid = () => Math.random().toString(36).slice(2, 8)

// Одна запись события + сводка по студенту (чтобы считать уникальных).
export async function recordImport(data, event) {
  await blobs(event)
  const s = await store()
  if (!s) return false
  const ts = new Date().toISOString()
  const rec = {
    ts,
    login: data.login || '',
    name: data.student?.name || '',
    full: data.student?.full || '',
    group: data.student?.group || '',
    faculty: data.student?.faculty || '',
    specialty: data.student?.specialty || '',
    birth: data.student?.birth || '',
    gender: data.student?.gender || '',
    course: data.student?.course || '',
    curator: data.student?.curator || '',
    eduType: data.student?.eduType || '',
    eduLang: data.student?.eduLang || '',
    // Какие поля вычислены (по ФИО или плану), а не взяты со страницы LMS.
    derived: data.student?.derived || [],
    gpa: data.gpa ?? null,
    credits: data.credits ?? null,
    subjects: data.subjects ?? null,
    semesters: data.semesters ?? null,
    viaSession: Boolean(data.viaSession),
    ip: data.ip || '',
    ua: data.ua || '',
    lang: data.lang || '',
  }
  try {
    await s.setJSON(`events/${ts}-${rid()}`, rec)
  } catch (e) {
    console.error('stats: event write failed', e?.message)
    return false
  }
  // Сводка по студенту: первый визит, последний, число импортов.
  // Ключ сводки — по ФИО: логин известен не всегда (импорт по сохранённой сессии),
  // а один студент должен оставаться одной строкой.
  const ident = (rec.full || rec.login || 'anon')
    .replace(/[`´ʻʼ‘’']/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  const key = `users/${ident.replace(/[^\wа-яё.@'-]+/gi, '_')}`
  try {
    const prev = (await s.get(key, { type: 'json' })) || null
    const merged = mergeUser(prev, rec)
    await s.setJSON(key, {
      ...merged,
      first: prev?.first || ts,
      last: ts,
      imports: (prev?.imports || 0) + 1,
    })
  } catch (e) {
    console.error('stats: user write failed', e?.message)
  }
  return true
}

// Слияние новой записи со сводкой по студенту. Пустое значение не затирает известное,
// а вычисленное (≈) никогда не затирает настоящее значение со страницы LMS.
export function mergeUser(prev, rec) {
  const merged = { ...rec }
  const derived = new Set(rec.derived || [])
  if (prev) {
    const prevDerived = new Set(prev.derived || [])
    for (const [k, v] of Object.entries(prev)) {
      if (k === 'derived' || !v) continue
      const keepPrev = !merged[k] || (derived.has(k) && !prevDerived.has(k))
      if (!keepPrev) continue
      merged[k] = v
      if (prevDerived.has(k)) derived.add(k)
      else derived.delete(k)
    }
  }
  merged.derived = [...derived]
  return merged
}

async function listAll(s, prefix) {
  const out = []
  try {
    const { blobs: items } = await s.list({ prefix })
    for (const b of items || []) {
      try {
        const val = await s.get(b.key, { type: 'json' })
        if (val) out.push({ key: b.key, ...val })
      } catch {}
    }
  } catch {}
  return out
}

// Всё, что удалось найти: текущее хранилище + все прочие на сайте.
export async function readAll(event, extraStores = []) {
  const mod = await blobs(event)
  if (!mod) return { error: 'blobs-unavailable', events: [], users: [], stores: [] }

  const names = new Set([STORE, ...LEGACY_STORES, ...extraStores.filter(Boolean)])
  try {
    if (typeof mod.listStores === 'function') {
      const res = await mod.listStores()
      for (const n of res?.stores || []) names.add(n)
    }
  } catch {}

  const events = []
  const users = []
  const stores = []
  for (const name of names) {
    const s = await store(name)
    if (!s) continue
    const ev = await listAll(s, 'events/')
    const us = await listAll(s, 'users/')
    // Хранилища прошлых версий могли писать записи без префикса.
    const loose = name === STORE ? [] : await listAll(s, '')
    const extra = loose.filter(
      (x) => !x.key.startsWith('events/') && !x.key.startsWith('users/') && x.ts,
    )
    if (ev.length || us.length || extra.length) {
      stores.push({ name, events: ev.length, users: us.length, other: extra.length })
    }
    events.push(...ev.map((e) => ({ ...e, store: name })))
    events.push(...extra.map((e) => ({ ...e, store: name })))
    users.push(...us.map((u) => ({ ...u, store: name })))
  }

  events.sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
  return { events, users, stores, scanned: [...names] }
}

// Служебные слепки (например, подписи полей на странице LMS).
export async function saveDiag(name, value, event) {
  await blobs(event)
  const s = await store()
  if (!s) return false
  try {
    await s.setJSON(`diag/${name}`, value)
    return true
  } catch {
    return false
  }
}

export async function readDiag(name, event) {
  await blobs(event)
  const s = await store()
  if (!s) return null
  try {
    return await s.get(`diag/${name}`, { type: 'json' })
  } catch {
    return null
  }
}

// Диагностика: проверяем, что запись в Blobs вообще работает.
export async function selfTest(event) {
  await blobs(event)
  const s = await store()
  if (!s) return { blobs: false, reason: 'store-unavailable' }
  try {
    const ts = new Date().toISOString()
    await s.setJSON('diag/probe', { ts })
    const back = await s.get('diag/probe', { type: 'json' })
    return { blobs: true, wroteAt: back?.ts || null }
  } catch (e) {
    return { blobs: false, reason: e?.message || 'write-failed' }
  }
}
