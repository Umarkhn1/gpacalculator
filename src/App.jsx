import { useEffect, useMemo, useState } from 'react'
import ImportModal from './ImportModal.jsx'
import { T, LANGS } from './i18n.js'
import { FLAGS } from './Flags.jsx'

const STORAGE_KEY = 'tuit-gpa-courses'
const LANG_KEY = 'tuit-gpa-lang'
const SESSION_KEY = 'tuit-gpa-session'
const STUDENT_KEY = 'tuit-gpa-student'
const GRADES = [5, 4, 3, 2]

// Декоративные мягкие блобы на фоне карточки балла (спокойное свечение).
const BLOBS = [
  { left: '-10%', top: '-15%', size: 150, delay: 0, dur: 18 },
  { left: '58%', top: '-25%', size: 120, delay: 4, dur: 22 },
  { left: '70%', top: '55%', size: 170, delay: 2, dur: 20 },
  { left: '-15%', top: '55%', size: 130, delay: 6, dur: 24 },
]

// По умолчанию — только кредит и оценка. Имя появляется лишь у импортированных предметов.
const emptyRow = () => ({ id: crypto.randomUUID(), name: '', credit: '', grade: '' })

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
  const [courses, setCourses] = useState(loadCourses)
  const [importOpen, setImportOpen] = useState(false)
  const [session, setSession] = useState(() => localStorage.getItem(SESSION_KEY) || '')
  const [student, setStudent] = useState(loadStudent)
  const t = T[lang]

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(courses))
  }, [courses])
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
        points += cr * gr
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
        id: crypto.randomUUID(),
        name: c.name,
        credit: String(c.credit),
        grade: c.grade ? String(c.grade) : '',
      })),
    )
    setImportOpen(false)
  }

  const gpaText = gpa.toFixed(2)
  const tone = gpa >= 4.5 ? 'high' : gpa >= 3.5 ? 'mid' : gpa > 0 ? 'low' : 'none'
  const status =
    tone === 'high'
      ? { cls: 'excellent', icon: '★', text: t.stExcellent }
      : tone === 'mid'
        ? { cls: 'good', icon: '✓', text: t.stGood }
        : tone === 'low'
          ? { cls: 'critical', icon: '!', text: t.stCritical }
          : null
  const CurrentFlag = FLAGS[lang]

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <img src="/logo.png" alt="TUIT" className="brand-logo" />
          <div className="brand-text">
            <span className="brand-name">GPA Calculator</span>
            <span className="brand-tag">{t.tagline}</span>
          </div>
        </div>

        <div className="top-actions">
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
          <a href="https://t.me/umarkhn_1" target="_blank" rel="noreferrer">
            Umarkhn1
          </a>
        </p>
      </footer>

      {importOpen && (
        <ImportModal
          t={t}
          session={session}
          onClose={() => setImportOpen(false)}
          onApply={applyImport}
          onAuth={saveAuth}
          onExpire={clearAuth}
        />
      )}
    </div>
  )
}
