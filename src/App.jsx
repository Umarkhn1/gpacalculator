import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import ImportModal from './ImportModal.jsx'
import Fireworks from './Fireworks.jsx'
import { unlockAudio } from './fireworksSound.js'
import { T, LANGS } from './i18n.js'
import { FLAGS } from './Flags.jsx'

const STORAGE_KEY = 'tuit-gpa-courses'
const LANG_KEY = 'tuit-gpa-lang'
const SESSION_KEY = 'tuit-gpa-session'
const STUDENT_KEY = 'tuit-gpa-student'
const PLAN_KEY = 'tuit-gpa-plan'
const THEME_KEY = 'tuit-gpa-theme'
const GRADES = [5, 4, 3, 2]

// Двойка — незачёт: в сумму баллов идёт нулём, но её кредиты в знаменателе остаются.
export const points5 = (grade) => (grade >= 3 ? grade : 0)

// Декоративные мягкие блобы на фоне карточки балла (спокойное свечение).
const BLOBS = [
  { left: '-10%', top: '-15%', size: 150, delay: 0, dur: 18 },
  { left: '58%', top: '-25%', size: 120, delay: 4, dur: 22 },
  { left: '70%', top: '55%', size: 170, delay: 2, dur: 20 },
  { left: '-15%', top: '55%', size: 130, delay: 6, dur: 24 },
]

// crypto.randomUUID есть только в защищённом контексте: по http (например, с телефона
// на локальный адрес) его нет, поэтому держим запасной генератор.
const uid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)

// По умолчанию — только кредит и оценка. Имя появляется лишь у импортированных предметов.
const emptyRow = () => ({ id: uid(), name: '', credit: '', grade: '' })

function loadCourses() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length) return parsed
    }
  } catch {}
  return Array.from({ length: 6 }, emptyRow)
}

// Последний импортированный учебный план — чтобы окно импорта открывалось с ним.
function loadPlan() {
  try {
    return JSON.parse(localStorage.getItem(PLAN_KEY) || 'null')
  } catch {
    return null
  }
}

function loadStudent() {
  try {
    return JSON.parse(localStorage.getItem(STUDENT_KEY) || 'null')
  } catch {
    return null
  }
}

export default function App() {
  const [lang, setLang] = useState(() => localStorage.getItem(LANG_KEY) || 'ru')
  const [langOpen, setLangOpen] = useState(false)
  // Тему до первого кадра выставляет скрипт в index.html — берём её оттуда.
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light')
  const [courses, setCourses] = useState(loadCourses)
  const [importOpen, setImportOpen] = useState(false)
  // Закладка возвращает нас с #i=<код> — сразу открываем импорт.
  const [handoff, setHandoff] = useState(() => {
    const m = window.location.hash.match(/#i=([\w-]+)/)
    if (!m) return ''
    window.history.replaceState(null, '', window.location.pathname)
    return m[1]
  })
  const [session, setSession] = useState(() => localStorage.getItem(SESSION_KEY) || '')
  const [student, setStudent] = useState(loadStudent)
  const [plan, setPlan] = useState(loadPlan)
  // Счётчик салютов: новый импорт во время салюта запускает его заново.
  const [fireworks, setFireworks] = useState(0)
  const logoRef = useRef(null)
  // Логотип — ровно по сетке физических пикселей: при масштабе Windows 125–150% он иначе
  // встаёт на полпикселя, браузер его пересчитывает, и печать мылится.
  useLayoutEffect(() => {
    const el = logoRef.current
    if (!el) return
    const snap = () => {
      el.style.transform = ''
      const r = el.getBoundingClientRect()
      const d = window.devicePixelRatio || 1
      const top = r.top + window.scrollY
      const dx = (Math.round(r.left * d) - r.left * d) / d
      const dy = (Math.round(top * d) - top * d) / d
      el.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : ''
    }
    snap()
    window.addEventListener('resize', snap)
    return () => window.removeEventListener('resize', snap)
  }, [])
  const t = T[lang]

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(courses))
  }, [courses])
  useEffect(() => {
    if (handoff) setImportOpen(true)
  }, [handoff])
  // Layout-эффект: тема должна примениться в том же кадре, что и flushSync ниже.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0b1220' : '#eef3f8')
  }, [theme])
  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang)
    document.documentElement.lang = lang
  }, [lang])

  const saveAuth = (sess, stud) => {
    setSession(sess)
    localStorage.setItem(SESSION_KEY, sess)
    if (stud) {
      setStudent(stud)
      localStorage.setItem(STUDENT_KEY, JSON.stringify(stud))
    }
  }
  const clearAuth = () => {
    setSession('')
    setStudent(null)
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(STUDENT_KEY)
  }
  const savePlan = (next) => {
    setPlan(next)
    try {
      localStorage.setItem(PLAN_KEY, JSON.stringify(next))
    } catch {}
    // Импорт без пароля сессии не даёт, но имя студента со страницы известно.
    if (next.student?.name) {
      setStudent(next.student)
      localStorage.setItem(STUDENT_KEY, JSON.stringify(next.student))
    }
  }
  const logout = () => {
    clearAuth()
    setPlan(null)
    localStorage.removeItem(PLAN_KEY)
  }

  // Смена темы: новая тема раскрывается кругом от кнопки (View Transitions).
  // Где API нет или просили меньше анимаций — просто плавно перетекают цвета.
  const toggleTheme = (e) => {
    const next = theme === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {}
    const root = document.documentElement
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!document.startViewTransition || calm) {
      root.classList.add('theme-anim')
      setTheme(next)
      setTimeout(() => root.classList.remove('theme-anim'), 450)
      return
    }
    const r = e.currentTarget.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const vt = document.startViewTransition(() => flushSync(() => setTheme(next)))
    vt.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 550, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
      )
    })
  }

  const hasNames = useMemo(() => courses.some((c) => c.name && c.name.trim()), [courses])

  const { gpa, totalCredits, graded } = useMemo(() => {
    let credits = 0
    let points = 0
    let counted = 0
    for (const c of courses) {
      const cr = parseFloat(c.credit)
      const gr = parseFloat(c.grade)
      if (!Number.isNaN(cr) && cr > 0 && !Number.isNaN(gr)) {
        credits += cr
        points += cr * points5(gr)
        counted += 1
      }
    }
    return {
      gpa: credits > 0 ? points / credits : 0,
      totalCredits: credits,
      graded: counted,
    }
  }, [courses])

  const update = (id, field, value) =>
    setCourses((cs) => cs.map((c) => (c.id === id ? { ...c, [field]: value } : c)))

  const addRow = () => setCourses((cs) => [...cs, emptyRow()])
  const removeRow = (id) =>
    setCourses((cs) => (cs.length > 1 ? cs.filter((c) => c.id !== id) : cs))
  const clearAll = () => setCourses(Array.from({ length: 6 }, emptyRow))

  const applyImport = (importedCourses) => {
    setCourses(
      importedCourses.map((c) => ({
        id: uid(),
        name: c.name,
        credit: String(c.credit),
        grade: c.grade ? String(c.grade) : '',
      })),
    )
    setImportOpen(false)

    // Салют — на ПК в тёмной теме, если после импорта балл не критичный (2.6 и выше).
    let credits = 0
    let points = 0
    for (const c of importedCourses) {
      if (!c.grade) continue
      credits += c.credit
      points += c.credit * points5(c.grade)
    }
    const importedGpa = credits ? points / credits : 0
    const desktop = window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (importedGpa >= 2.6 && theme === 'dark' && desktop && !calm) {
      // Мы ещё внутри клика по кнопке импорта — самое время разблокировать звук.
      unlockAudio()
      setFireworks((n) => n + 1)
    }
  }

  const gpaText = gpa.toFixed(2)
  // Ступени балла: 4.5+ отлично, 3.5+ хорошо, 2.6+ нормально, ниже 2.6 критично.
  const tone =
    gpa >= 4.5 ? 'high' : gpa >= 3.5 ? 'mid' : gpa >= 2.6 ? 'norm' : gpa > 0 ? 'low' : 'none'
  const status =
    tone === 'high'
      ? { cls: 'excellent', icon: '★', text: t.stExcellent }
      : tone === 'mid'
        ? { cls: 'good', icon: '✓', text: t.stGood }
        : tone === 'norm'
          ? { cls: 'normal', icon: '~', text: t.stNormal }
          : tone === 'low'
            ? { cls: 'critical', icon: '!', text: t.stCritical }
            : null
  const CurrentFlag = FLAGS[lang]

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <img
            src="/logo-104.png"
            srcSet="/logo-46.png 46w, /logo-52.png 52w, /logo-58.png 58w, /logo-65.png 65w, /logo-69.png 69w, /logo-78.png 78w, /logo-92.png 92w, /logo-104.png 104w, /logo-138.png 138w, /logo-156.png 156w"
            sizes="(max-width: 600px) 46px, 52px"
            width="52"
            height="52"
            alt="TUIT"
            className="brand-logo"
            ref={logoRef}
          />
          <div className="brand-text">
            <span className="brand-name">GPA Calculator</span>
            <span className="brand-tag">{t.tagline}</span>
          </div>
        </div>

        <div className="top-actions">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t.themeLight : t.themeDark}
            title={theme === 'dark' ? t.themeLight : t.themeDark}
          >
            <svg className="ti ti-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4.2" />
              <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
            </svg>
            <svg className="ti ti-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.8 6.8 0 0 0 10.7 10.7z" />
            </svg>
          </button>
          <div className="lang">
            <button
              className="lang-trigger"
              onClick={() => setLangOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={langOpen}
            >
              <CurrentFlag />
              <span className="lang-code">{lang.toUpperCase()}</span>
              <svg className={'chev' + (langOpen ? ' up' : '')} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {langOpen && (
              <>
                <div className="lang-backdrop" onClick={() => setLangOpen(false)} />
                <ul className="lang-menu" role="listbox">
                  {LANGS.map((code) => {
                    const Flag = FLAGS[code]
                    return (
                      <li key={code}>
                        <button
                          className={'lang-option' + (lang === code ? ' active' : '')}
                          onClick={() => {
                            setLang(code)
                            setLangOpen(false)
                          }}
                          role="option"
                          aria-selected={lang === code}
                        >
                          <Flag />
                          <span>{T[code].langName}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="layout">
        <aside className="hero">
          <div className="hero-bg" aria-hidden="true">
            {BLOBS.map((b, i) => (
              <span
                key={i}
                className="blob"
                style={{
                  left: b.left,
                  top: b.top,
                  width: b.size + 'px',
                  height: b.size + 'px',
                  animationDelay: b.delay + 's',
                  animationDuration: b.dur + 's',
                }}
              />
            ))}
          </div>

          {student?.name && (
            <div className="hero-greet">
              <span className="greet-hand">👋</span>
              <span className="greet-text">
                {t.greeting}, <b>{student.name}</b>
              </span>
            </div>
          )}

          <div className="hero-body">
            <div className="hero-row">
              <div className="hero-score">
                <div className={'hero-num tone-' + tone}>{gpaText}</div>
                <div className="hero-meta">
                  <span className="hero-scale">/ 5.0</span>
                  {status && (
                    <span className={'status-pill st-' + status.cls}>
                      <span className="st-icon">{status.icon}</span>
                      <span className="st-text">{status.text}</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="hero-stats">
                <div className="stat">
                  <b>{graded}</b>
                  <span>{t.subjects(graded).replace(/^\d+\s/, '')}</span>
                </div>
                <div className="stat">
                  <b>{totalCredits}</b>
                  <span>{t.credits}</span>
                </div>
              </div>
            </div>

            <p className="hero-note">
              {t.noteBefore}
              <a href="https://lms.tuit.uz/student/study-plan" target="_blank" rel="noreferrer">
                {t.noteLink}
              </a>
              {t.noteAfter}
            </p>
          </div>
        </aside>

        <button className="btn btn-line import-cta" onClick={() => setImportOpen(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {t.importBtn}
        </button>

        <main className={'panel' + (hasNames ? ' named' : '')}>
          <div className="list-head">
            <span className="col-idx">{t.thNum}</span>
            {hasNames && <span className="col-name">{t.thName}</span>}
            <span className="col-cr">{t.thCr}</span>
            <span className="col-gr">{t.thGr}</span>
            <span className="col-x" />
          </div>

          <div className="list">
            {courses.map((c, i) => (
              <div className="row" key={c.id}>
                <span className="col-idx">{i + 1}</span>
                {hasNames && (
                  <input
                    className="col-name field"
                    type="text"
                    placeholder={t.thName}
                    value={c.name}
                    onChange={(e) => update(c.id, 'name', e.target.value)}
                  />
                )}
                <input
                  className="col-cr field field-center"
                  type="number"
                  min="1"
                  inputMode="numeric"
                  placeholder={t.thCr}
                  value={c.credit}
                  onChange={(e) => update(c.id, 'credit', e.target.value)}
                />
                <select
                  className={'col-gr field field-center grade-pick' + (c.grade ? ' g' + c.grade : ' field-empty')}
                  value={c.grade}
                  onChange={(e) => update(c.id, 'grade', e.target.value)}
                >
                  <option value="">—</option>
                  {GRADES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
                <button
                  className="col-x icon-btn"
                  onClick={() => removeRow(c.id)}
                  aria-label="×"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="actions">
            <button className="btn btn-line" onClick={addRow}>
              {t.addSubject}
            </button>
            <button className="btn btn-broom" onClick={clearAll} title={t.clear} aria-label={t.clear}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          </div>
        </main>
      </div>

      <footer className="foot">
        <p className="foot-made">{t.footerMade}</p>
        <p className="foot-by">
          {t.footerBy}{' '}
          <a href="https://www.umar-dev.uz/" target="_blank" rel="noreferrer">
            {"Umarxo'ja O'tkurxo'jayev"}
          </a>
        </p>
      </footer>

      {fireworks > 0 && <Fireworks key={fireworks} word={t.bravo} onDone={() => setFireworks(0)} />}

      {importOpen && (
        <ImportModal
          t={t}
          session={session}
          code={handoff}
          onClose={() => {
            setImportOpen(false)
            setHandoff('')
          }}
          onApply={applyImport}
          onAuth={saveAuth}
          onExpire={clearAuth}
          plan={plan}
          onPlan={savePlan}
          onLogout={logout}
        />
      )}
    </div>
  )
}
