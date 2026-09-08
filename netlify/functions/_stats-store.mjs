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
  try {
    return mod.getStore({ name, consistency: 'strong' })
  } catch {
    try {
      return mod.getStore(name)
    } catch {
      return null
    }
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
  const key = `users/${(rec.login || rec.full || 'anon').replace(/[^\w.@-]+/g, '_')}`
  try {
    const prev = (await s.get(key, { type: 'json' })) || null
    await s.setJSON(key, {
      ...rec,
      first: prev?.first || ts,
      last: ts,
      imports: (prev?.imports || 0) + 1,
    })
  } catch (e) {
    console.error('stats: user write failed', e?.message)
  }
  return true
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
export async function readAll(event) {
  const mod = await blobs(event)
  if (!mod) return { error: 'blobs-unavailable', events: [], users: [], stores: [] }

  const names = new Set([STORE, ...LEGACY_STORES])
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
  return { events, users, stores }
}
