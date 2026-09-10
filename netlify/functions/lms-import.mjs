// Netlify serverless-функция: авторизуется в lms.tuit.uz (по логину/паролю или по
// сохранённой сессии) и возвращает учебный план + имя студента + строку сессии.
// Сессия позволяет повторно импортировать без повторного ввода пароля.

import { recordImport, saveDiag, readDiag } from './_stats-store.mjs'

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

export function parseStudent(html) {
  const m = html.match(/si-student-name"[^>]*>([^<]+)</)
  const full = m ? strip(m[1]) : ''
  const tokens = full.split(/\s+/).filter(Boolean)
  // Формат: Фамилия Имя Отчество [o‘g‘li/qizi] → имя это второе слово.
  const name = tokens[1] || tokens[0] || ''
  return { full, name }
}

// Разметка /student/info меняется (таблица, список, карточки), поэтому не
// привязываемся к тегам: разбираем страницу в поток текстовых кусочков и берём
// значение, идущее сразу за подписью. Апострофы у узбекских слов бывают разные.
const norm = (s) =>
  String(s)
    .replace(/[`´ʻʼ‘’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

function textChunks(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .split(/<[^>]+>/)
    .map((t) => norm(strip(t)))
    .filter((t) => t && t !== ':' && t !== '-' && t !== '—')
}

// Подписи полей на трёх языках LMS.
const INFO_LABELS = {
  group: /^(guruh|guruhi|группа|group)/i,
  faculty: /(fakultet|факульт|faculty)/i,
  specialty: /(yo'nalish|mutaxassis|направлен|специальн|specialt|ta'lim dasturi)/i,
  birth: /(tug'ilgan (sana|kun|yil)|дата рожд|birth ?date|date of birth|туғилган)/i,
  gender: /^(jinsi|jins|пол|gender|sex)/i,
  course: /^(kurs|kursi|курс|course|year)/i,
  curator: /(kurator|tyutor|тьютор|куратор|tutor|mentor)/i,
  eduType: /(ta'lim (shakli|turi)|o'qish shakli|форма обуч|тип обуч|вид обуч|education (form|type)|form of (study|education))/i,
  eduLang: /(ta'lim tili|o'qish tili|guruh tili|язык обуч|язык групп|language of|education language)/i,
  studentId: /(talaba id|student id|hemis|id raqam|shaxsiy raqam)/i,
}
// Подпись — это короткий кусочек до двоеточия: «Guruh», «Пол:», «Ta'lim tili».
const labelHead = (s) => String(s).split(':')[0].trim()
const matchesLabel = (re, chunk) => {
  const head = labelHead(chunk)
  return head.length <= 40 && re.test(head)
}
const isLabel = (s) => Object.values(INFO_LABELS).some((re) => matchesLabel(re, s))

// Значение может стоять в том же кусочке («Jinsi: Erkak») или в следующих.
function pickValue(chunks, i, ok) {
  const inline = chunks[i].split(/:\s*/).slice(1).join(': ').trim()
  if (inline && (!ok || ok(inline))) return inline
  for (let j = i + 1; j < Math.min(i + 4, chunks.length); j += 1) {
    const v = chunks[j].replace(/:$/, '').trim()
    if (!v || isLabel(v) || v.length > 120) continue
    if (!ok || ok(v)) return v
    return ''
  }
  return ''
}

const VALID = {
  birth: (v) => /\d{2}[./-]\d{2}[./-]\d{4}|\d{4}[./-]\d{2}[./-]\d{2}/.test(v),
  gender: (v) => /erkak|ayol|мужск|женск|male|female|o'g'il|qiz/i.test(norm(v)),
  course: (v) => /^\s*[1-8]\b/.test(v),
}

// Все поля со страницы /student/info — их показывает дашборд.
export function parseInfo(html) {
  const chunks = textChunks(html)
  const out = {}
  for (const [field, re] of Object.entries(INFO_LABELS)) {
    let value = ''
    for (let i = 0; i < chunks.length && !value; i += 1) {
      if (matchesLabel(re, chunks[i])) value = pickValue(chunks, i, VALID[field])
    }
    out[field] = value
  }
  // Пол приводим к одному виду, курс — к числу.
  if (out.gender) {
    out.gender = /erkak|мужск|male|o'g'il/i.test(norm(out.gender)) ? 'Мужской' : 'Женский'
  }
  if (out.course) out.course = (out.course.match(/[1-8]/) || [''])[0]
  return out
}

// Вставка из буфера: если пришёл не HTML, а текст, собираем из строк таблицу —
// при копировании таблицы ячейки разделены табами.
function textToTable(text) {
  const rows = String(text)
    .split(/\r?\n/)
    .map((line) => line.split(/\t|\s{2,}/).map((c) => c.trim()))
    .filter((cells) => cells.length >= 3)
  if (!rows.length) return ''
  return (
    '<table>' +
    rows
      .map((cells) => '<tr>' + cells.map((c) => `<td>${c}</td>`).join('') + '</tr>')
      .join('') +
    '</table>'
  )
}

// ---------- то, что можно вычислить без страницы «Информация» ----------
// При импорте без пароля есть только учебный план и ФИО. Пол, курс и язык обучения
// из них выводятся; такие поля помечаются как вычисленные и в дашборде идут с «≈».

// Пол по ФИО: узбекское отчество o'g'li / qizi, иначе — окончание фамилии.
export function genderFromName(full) {
  const n = norm(full).toLowerCase()
  if (/(^|\s)(o'?g'?li|ogli|ўғли|угли|оглы)(\s|$)/.test(n)) return 'Мужской'
  if (/(^|\s)(qizi|қизи|кизи|кызы)(\s|$)/.test(n)) return 'Женский'
  const surname = n.split(/\s+/)[0] || ''
  if (/(ova|eva|yeva|ова|ева)$/.test(surname)) return 'Женский'
  if (/(ov|ev|yev|ов|ев)$/.test(surname)) return 'Мужской'
  return ''
}

// Курс по учебному плану: семестр закрыт, если оценки стоят хотя бы у половины предметов.
// Текущий семестр — следующий за последним закрытым.
export function courseFromPlan(semesters) {
  if (!semesters.length) return ''
  let done = 0
  semesters.forEach((s, i) => {
    const graded = s.courses.filter((c) => c.grade).length
    if (s.courses.length && graded / s.courses.length >= 0.5) done = i + 1
  })
  const current = Math.min(done + 1, semesters.length)
  return String(Math.ceil(current / 2))
}

// Язык обучения по названиям предметов: кириллица — RU, латиница — UZ или EN.
export function langFromPlan(semesters) {
  const text = semesters.flatMap((s) => s.courses.map((c) => c.name)).join(' ')
  const cyr = (text.match(/[а-яё]/gi) || []).length
  const lat = (text.match(/[a-z]/gi) || []).length
  if (!cyr && !lat) return ''
  if (cyr / (cyr + lat) > 0.6) return 'RU'
  const t = norm(text).toLowerCase()
  const uz = (t.match(/o'|g'|q|x|sh|ch|lari|lash|ning|asoslari|tizim/g) || []).length
  const en = (t.match(/tion|ing\b|\bthe\b|\band\b|\bof\b|ics\b|ment\b/g) || []).length
  return en > uz ? 'EN' : 'UZ'
}

// Заполняем только пустые поля и запоминаем, какие из них вычислены.
function deriveMissing(student, semesters) {
  const out = { derived: [] }
  const guess = {
    gender: genderFromName(student.full || ''),
    course: courseFromPlan(semesters),
    eduLang: langFromPlan(semesters),
  }
  for (const [field, value] of Object.entries(guess)) {
    if (!student[field] && value) {
      out[field] = value
      out.derived.push(field)
    }
  }
  return out
}

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    // Закладка-импорт работает со страницы lms.tuit.uz.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  },
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
  // Успех — LMS уводит со страницы входа (на дашборд).
  if (auth.status === 302 && !/auth\/login|login\/oneid/.test(location)) return { ok: true }
  return { error: 401, ...(await loginFailure(cookies, auth, location)) }
}

// Отличаем «неверный пароль» от «LMS не пускает по паролю» (требует OneID и т. п.).
// Если LMS прямо не сказал, что данные неверные, человека не виним — честно пишем,
// что вход по паролю сейчас недоступен.
const WRONG_RE = /(mavjud emas|noto'?g'?ri|parol xato|неверн|не найден|не совпада|incorrect|do not match|invalid credentials|not found)/i

export function classifyLoginPage(html, location = '') {
  if (/oneid/i.test(location)) return { oneid: true, message: '' }
  const message = loginMessage(html)
  if (mentionsOneid(html) || /one\s?id/i.test(message)) return { oneid: true, message }
  if (WRONG_RE.test(norm(message))) return { wrong: true, message }
  return { unknown: true, message }
}

// Текст ошибки: плашки alert, подсказки под полями и всплывающие уведомления.
function loginMessage(html) {
  const parts = []
  const boxes = /<div[^>]*class="[^"]*\b(?:alert|invalid-feedback|text-danger|error)\b[^"]*"[^>]*>([\s\S]{0,600}?)<\/div>/gi
  for (const m of html.matchAll(boxes)) {
    parts.push(strip(m[1].replace(/<button[\s\S]*?<\/button>/gi, ' ')).replace(/^×\s*/, ''))
  }
  const toasts = /(?:toastr\.\w+|Swal\.fire|swal|alert)\(\s*(?:\{[^}]*?(?:text|title|html)\s*:\s*)?['"`]([^'"`]{3,300})['"`]/gi
  for (const m of html.matchAll(toasts)) parts.push(m[1])
  return parts.filter(Boolean).join(' ').slice(0, 300)
}

// Упоминание OneID где-нибудь, кроме самой кнопки «OneID» — она на странице входа есть всегда.
function mentionsOneid(html) {
  const rest = html.replace(/<a[^>]*login\/oneid[\s\S]*?<\/a>/gi, ' ').replace(/<img[^>]*oneid[^>]*>/gi, ' ')
  return /one\s?id/i.test(rest)
}

async function loginFailure(cookies, auth, location) {
  try {
    // Ошибка могла прийти прямо в ответе на отправку формы…
    if (auth.status === 200) return classifyLoginPage(await auth.text(), location)
    if (/oneid/i.test(location)) return { oneid: true, message: '' }
    // …или флеш-сообщением на странице входа после редиректа.
    const res = await fetch(`${LMS}/auth/login`, {
      headers: { 'User-Agent': UA, Cookie: cookieHeader(cookies) },
      redirect: 'manual',
    })
    const next = res.headers.get('location') || ''
    return classifyLoginPage(res.status === 200 ? await res.text() : '', next)
  } catch {
    return { unknown: true, message: '' }
  }
}

// Средний балл: сумма (балл × кредит) по всем предметам / сумма их кредитов.
// Двойка идёт нулём баллов, но её кредиты остаются в знаменателе.
const points5 = (grade) => (grade >= 3 ? grade : 0)

function gpaOf(semesters) {
  let credits = 0
  let points = 0
  let subjects = 0
  for (const s of semesters) {
    for (const c of s.courses) {
      if (!c.grade) continue
      credits += c.credit
      points += c.credit * points5(c.grade)
      subjects += 1
    }
  }
  return { gpa: credits ? +(points / credits).toFixed(2) : 0, credits, subjects }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {})
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  let login_, password, session, pasted, info, handoff, code
  try {
    ;({
      login: login_,
      password,
      session,
      html: pasted,
      info,
      handoff,
      code,
    } = JSON.parse(event.body || '{}'))
  } catch {
    return json(400, { error: 'Неверный запрос' })
  }

  // Забираем результат, отложенный закладкой: код одноразовый.
  if (code) {
    const saved = await readDiag(`handoff-${String(code).replace(/[^\w-]/g, '')}`, event)
    if (!saved) return json(404, { error: 'Ссылка устарела' })
    return json(200, saved)
  }

  // Импорт вставкой: пользователь скопировал учебный план из LMS (вход через OneID),
  // пароль в этом случае не нужен.
  if (pasted) {
    const html = /<t[dr][ >]/i.test(pasted) ? pasted : textToTable(pasted)
    const semesters = parseStudyPlan(html)
    if (!semesters.length) return json(422, { error: 'Оценки не найдены' })
    // Закладка присылает и страницу профиля — из неё берём данные студента.
    const src = info || html
    const student = { ...parseStudent(src), ...parseInfo(src) }
    Object.assign(student, deriveMissing(student, semesters))
    const headers = event.headers || {}
    await recordImport(
      {
        login: student.studentId || '',
        student,
        ...gpaOf(semesters),
        semesters: semesters.length,
        viaSession: false,
        pasted: true,
        ip: headers['x-nf-client-connection-ip'] || headers['client-ip'] || '',
        ua: headers['user-agent'] || '',
        lang: (headers['accept-language'] || '').split(',')[0] || '',
      },
      event,
    )
    const result = { semesters, student, session: '' }
    if (handoff) {
      // Закладка не может открыть калькулятор с данными в адресе — кладём их
      // в хранилище на один раз и отдаём короткий код.
      const key = Math.random().toString(36).slice(2, 10)
      await saveDiag(`handoff-${key}`, result, event)
      return json(200, { code: key })
    }
    return json(200, result)
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
      // «Неверный пароль» — только если LMS сказал это прямо. Всё остальное (требует OneID,
      // непонятный ответ) — «вход по паролю временно недоступен».
      if (res.error === 401 && res.wrong) {
        return json(401, { error: res.message || 'Неверный логин или пароль' })
      }
      if (res.error === 401) {
        return json(401, { unavailable: true, oneid: Boolean(res.oneid), error: 'Вход по паролю временно недоступен' })
      }
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

    // Данные студента. Страницу пробуем дважды: LMS иногда отвечает пустым.
    let student = { full: '', name: '' }
    let infoChunks = []
    for (let attempt = 0; attempt < 2 && !student.full; attempt += 1) {
      try {
        const infoRes = await fetch(`${LMS}/student/info`, {
          headers: { 'User-Agent': UA, Cookie: cookieHeader(cookies) },
          redirect: 'manual',
        })
        if (infoRes.status !== 200) continue
        const infoHtml = await infoRes.text()
        student = { ...parseStudent(infoHtml), ...parseInfo(infoHtml) }
        infoChunks = textChunks(infoHtml).slice(0, 120)
      } catch {}
    }

    // Если страницу «Информация» получить не удалось — хотя бы то, что вычисляется.
    Object.assign(student, deriveMissing(student, semesters))

    // Статистика для дашборда. Ошибки записи не должны ломать импорт.
    const headers = event.headers || {}
    // Слепок подписей страницы — по нему видно, если LMS переименует поля.
    await saveDiag('info-chunks', { ts: new Date().toISOString(), chunks: infoChunks }, event)
    await recordImport({
      login: login_ || student.studentId || '',
      student,
      ...gpaOf(semesters),
      semesters: semesters.length,
      viaSession: Boolean(session),
      ip: headers['x-nf-client-connection-ip'] || headers['client-ip'] || '',
      ua: headers['user-agent'] || '',
      lang: (headers['accept-language'] || '').split(',')[0] || '',
    }, event)

    return json(200, { semesters, student, session: cookieHeader(cookies) })
  } catch (e) {
    console.error(e)
    return json(500, { error: 'Ошибка соединения с LMS' })
  }
}
