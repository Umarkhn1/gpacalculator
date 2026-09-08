// Netlify serverless-функция: авторизуется в lms.tuit.uz (по логину/паролю или по
// сохранённой сессии) и возвращает учебный план + имя студента + строку сессии.
// Сессия позволяет повторно импортировать без повторного ввода пароля.

import { recordImport } from './_stats-store.mjs'

const LMS = 'https://lms.tuit.uz'
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

function mergeCookies(store, setCookies) {
  for (const sc of setCookies) {
    const [pair] = sc.split(';')
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    store.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
  }
}
const cookieHeader = (store) =>
  [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; ')

function cookiesFromString(str) {
  const store = new Map()
  for (const part of String(str).split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    store.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim())
  }
  return store
}

function getSetCookie(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie()
  const raw = res.headers.get('set-cookie')
  return raw ? [raw] : []
}

const strip = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const NAME_RE = /дисциплин|предмет|fan nomi|subject|модул/i
const CREDIT_RE = /кредит|kredit|credit|ects/i
// «Оценка», «Baho», «Ball», «Итоговый балл», «Reyting» — всё, что может нести оценку.
const GRADE_RE = /оцен|baho|ball|балл|grade|итог|natija|reyting|zlashtir/i

const numOf = (s) => {
  const m = String(s).replace(',', '.').match(/-?\d+(\.\d+)?/)
  return m ? parseFloat(m[0]) : NaN
}

// LMS отдаёт оценку либо по 5-балльной шкале, либо рейтингом 0–100.
// Приводим всё к 5-балльной: 86+ → 5, 71+ → 4, 60+ → 3, иначе 2.
function toGrade(raw) {
  const s = String(raw == null ? '' : raw).trim()
  if (!s) return null
  const n = numOf(s)
  if (Number.isNaN(n)) return null
  if (Number.isInteger(n) && n >= 2 && n <= 5 && s.length <= 3) return n
  if (n > 5 && n <= 100) {
    if (n >= 86) return 5
    if (n >= 71) return 4
    if (n >= 60) return 3
    return 2
  }
  return null
}

// Определяем, в каких колонках лежат название / кредит / оценка.
// Сначала по строке заголовка, если она есть; иначе — позиции по умолчанию.
function detectColumns(rowsCells) {
  const cols = { name: 0, credit: 1, grade: 2, headerSeen: false }
  for (const cells of rowsCells) {
    if (cells.length < 3) continue
    const nameIdx = cells.findIndex((c) => NAME_RE.test(c))
    const creditIdx = cells.findIndex((c) => CREDIT_RE.test(c))
    let gradeIdx = -1
    cells.forEach((c, i) => {
      // Если колонок с оценкой несколько, берём последнюю — она итоговая.
      if (GRADE_RE.test(c)) gradeIdx = i
    })
    if (creditIdx > -1 && gradeIdx > -1 && creditIdx !== gradeIdx) {
      cols.name = nameIdx > -1 && nameIdx !== creditIdx ? nameIdx : 0
      cols.credit = creditIdx
      cols.grade = gradeIdx
      cols.headerSeen = true
      return cols
    }
  }
  return cols
}

export function parseStudyPlan(html) {
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
  const tables = html.match(/<table[\s\S]*?<\/table>/g) || []
  const semesters = []
  tables.forEach((table, i) => {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/g) || []
    const rowsCells = rows.map((row) =>
      (row.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || []).map(strip),
    )
    const cols = detectColumns(rowsCells)
    const courses = []
    for (const cells of rowsCells) {
      if (cells.length < 3) continue
      // Пропускаем строку заголовка.
      if (CREDIT_RE.test(cells[cols.credit] || '')) continue
      // Убираем скобки: «Исчисление (Calculus) (6 kr)» → «Исчисление».
      const name = String(cells[cols.name] || '')
        .replace(/\s*\([^)]*\)/g, '')
        .trim()
      const credit = numOf(cells[cols.credit])
      if (!name || Number.isNaN(credit) || credit <= 0) continue
      const grade = toGrade(cells[cols.grade])
      courses.push({ name, credit, grade })
    }
    if (courses.length) {
      semesters.push({ num: roman[i] || String(i + 1), courses })
    }
  })
  return semesters
}

function parseStudent(html) {
  const m = html.match(/si-student-name"[^>]*>([^<]+)</)
  const full = m ? strip(m[1]) : ''
  const tokens = full.split(/\s+/).filter(Boolean)
  // Формат: Фамилия Имя Отчество [o‘g‘li/qizi] → имя это второе слово.
  const name = tokens[1] || tokens[0] || ''
  return { full, name }
}

// Группа и направление со страницы /student/info — для дашборда.
function parseInfo(html) {
  const grab = (re) => {
    const m = html.match(re)
    return m ? strip(m[1]) : ''
  }
  return {
    group: grab(/(?:Гурух|Guruh|Группа|Group)[^<]*<[^>]*>([^<]{1,40})</i),
    faculty: grab(/(?:Факультет|Fakultet|Faculty)[^<]*<[^>]*>([^<]{1,80})</i),
  }
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
})

async function login(cookies, loginId, password) {
  const page = await fetch(`${LMS}/auth/login`, {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  })
  mergeCookies(cookies, getSetCookie(page))
  const html = await page.text()
  const token = html.match(/name="_token"\s+value="([^"]+)"/)
  if (!token) return { error: 502 }

  const form = new URLSearchParams()
  form.set('_token', token[1])
  form.set('login', loginId)
  form.set('password', password)
  form.set('g-recaptcha-response', '')

  const auth = await fetch(`${LMS}/auth/login`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${LMS}/auth/login`,
      Cookie: cookieHeader(cookies),
    },
    body: form.toString(),
    redirect: 'manual',
  })
  mergeCookies(cookies, getSetCookie(auth))
  const location = auth.headers.get('location') || ''
  if (auth.status !== 302 || /auth\/login/.test(location)) return { error: 401 }
  return { ok: true }
}

// Средний балл: сумма (балл × кредит) по всем предметам / сумма их кредитов.
function gpaOf(semesters) {
  let credits = 0
  let points = 0
  let subjects = 0
  for (const s of semesters) {
    for (const c of s.courses) {
      if (!c.grade) continue
      credits += c.credit
      points += c.credit * c.grade
      subjects += 1
    }
  }
  return { gpa: credits ? +(points / credits).toFixed(2) : 0, credits, subjects }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  let login_, password, session
  try {
    ;({ login: login_, password, session } = JSON.parse(event.body || '{}'))
  } catch {
    return json(400, { error: 'Неверный запрос' })
  }

  try {
    let cookies
    if (session) {
      // Повторный импорт по сохранённой сессии — пароль не нужен.
      cookies = cookiesFromString(session)
    } else {
      if (!login_ || !password) return json(400, { error: 'Введите логин и пароль' })
      cookies = new Map()
      const res = await login(cookies, login_, password)
      if (res.error === 401) return json(401, { error: 'Неверный логин или пароль' })
      if (res.error) return json(502, { error: 'Не удалось войти в LMS' })
    }

    // Учебный план.
    const planRes = await fetch(`${LMS}/student/study-plan`, {
      headers: { 'User-Agent': UA, Cookie: cookieHeader(cookies) },
      redirect: 'manual',
    })
    if (planRes.status !== 200) {
      // Просроченная/битая сессия — просим войти заново.
      if (session) return json(401, { expired: true, error: 'Сессия истекла' })
      return json(502, { error: 'Не удалось открыть учебный план' })
    }
    const semesters = parseStudyPlan(await planRes.text())
    if (!semesters.length) return json(502, { error: 'Оценки не найдены' })

    // Имя студента.
    let student = { full: '', name: '' }
    try {
      const infoRes = await fetch(`${LMS}/student/info`, {
        headers: { 'User-Agent': UA, Cookie: cookieHeader(cookies) },
        redirect: 'manual',
      })
      if (infoRes.status === 200) {
        const infoHtml = await infoRes.text()
        student = { ...parseStudent(infoHtml), ...parseInfo(infoHtml) }
      }
    } catch {}

    // Статистика для дашборда. Ошибки записи не должны ломать импорт.
    const headers = event.headers || {}
    await recordImport({
      login: login_ || '',
      student,
      ...gpaOf(semesters),
      semesters: semesters.length,
      viaSession: Boolean(session),
      ip: headers['x-nf-client-connection-ip'] || headers['client-ip'] || '',
      ua: headers['user-agent'] || '',
      lang: (headers['accept-language'] || '').split(',')[0] || '',
    })

    return json(200, { semesters, student, session: cookieHeader(cookies) })
  } catch (e) {
    console.error(e)
    return json(500, { error: 'Ошибка соединения с LMS' })
  }
}
