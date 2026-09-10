import { useEffect, useRef, useState } from 'react'
import { readGradesFile } from './readFile.js'

const ENDPOINTS = ['/api/lms/import', '/.netlify/functions/lms-import']
const PLAN_URL = 'https://lms.tuit.uz/student/study-plan'

// Средний балл: сумма (балл × кредит) / сумма кредитов предметов с оценкой.
// Двойка засчитывается нулём баллов, но её кредиты остаются в знаменателе.
const points5 = (grade) => (grade >= 3 ? grade : 0)

function gpaOf(list) {
  let cr = 0
  let pts = 0
  for (const c of list) {
    if (c.grade) {
      cr += c.credit
      pts += c.credit * points5(c.grade)
    }
  }
  return cr ? pts / cr : 0
}

// Семестры → курсы (в каждом курсе два семестра).
function groupCourses(semesters) {
  const courses = []
  for (let i = 0; i < semesters.length; i += 2) {
    courses.push({ course: i / 2 + 1, semesters: semesters.slice(i, i + 2) })
  }
  return courses
}

// По умолчанию открываем последний курс, где уже есть оценки.
function defaultCourse(grouped) {
  let def = grouped.length - 1
  grouped.forEach((c, i) => {
    if (c.semesters.some((s) => s.courses.some((x) => x.grade))) def = i
  })
  return def
}

const flatten = (course) => course.semesters.flatMap((s) => s.courses)

export default function ImportModal({
  t,
  session,
  code,
  plan,
  onClose,
  onApply,
  onAuth,
  onExpire,
  onPlan,
  onLogout,
}) {
  // Последний импорт хранит калькулятор: после импорта без пароля сессии нет,
  // поэтому окно при повторном открытии сразу показывает выбор курса, а не просит файл заново.
  const saved = !session && !code && plan?.semesters?.length ? plan.semesters : null
  const [step, setStep] = useState(session || code ? 'loading' : saved ? 'pick' : 'login')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const lastPaste = useRef('')
  const [courses, setCourses] = useState(() => (saved ? groupCourses(saved) : []))
  const [sel, setSel] = useState(() => (saved ? defaultCourse(groupCourses(saved)) : 0))

  const showPlan = (semesters) => {
    const grouped = groupCourses(semesters)
    setCourses(grouped)
    setSel(defaultCourse(grouped))
    setStep('pick')
  }

  const handleData = (data) => {
    if (data.session) onAuth(data.session, data.student)
    onPlan({ semesters: data.semesters, student: data.student })
    showPlan(data.semesters)
  }

  const request = async (payload) => {
    let lastError = null
    // Второй адрес — прямой путь к функции: выручает, если редирект /api/* не сработал.
    for (const url of ENDPOINTS) {
      let res
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } catch (e) {
        lastError = e
        continue
      }
      if (res.status === 404) {
        lastError = new Error(t.errServer)
        continue
      }
      const text = await res.text()
      try {
        return { res, data: text ? JSON.parse(text) : {} }
      } catch {
        // Пришёл HTML вместо JSON — функции нет по этому адресу, пробуем следующий.
        lastError = new Error(t.errServer)
      }
    }
    throw lastError || new Error(t.errServer)
  }

  // Импорт, подготовленный закладкой: данные лежат по одноразовому коду.
  useEffect(() => {
    if (!code) return
    let cancelled = false
    ;(async () => {
      try {
        const { res, data } = await request({ code })
        if (cancelled) return
        if (!res.ok || !data.semesters?.length) throw new Error(data.error || t.errServer)
        handleData(data)
      } catch (err) {
        if (!cancelled) {
          setStep('login')
          setError(err.message || t.errServer)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Автовход по сохранённой сессии — без повторного ввода пароля.
  useEffect(() => {
    if (!session || code) return
    let cancelled = false
    ;(async () => {
      try {
        const { res, data } = await request({ session })
        if (cancelled) return
        if (res.status === 401 || data.expired) {
          onExpire()
          // Сессия истекла, но последний импорт остался — показываем его.
          if (plan?.semesters?.length) showPlan(plan.semesters)
          else setStep('login')
          return
        }
        if (!res.ok || !data.semesters?.length) throw new Error(data.error || t.errServer)
        handleData(data)
      } catch (err) {
        if (!cancelled) {
          onExpire()
          if (plan?.semesters?.length) showPlan(plan.semesters)
          else {
            setStep('login')
            setError(err.message || t.errServer)
          }
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Импорт вставкой: страница учебного плана прямо из буфера обмена.
  const submitPaste = async (payload, silent = false) => {
    if (!payload || payload.length < 40) {
      if (!silent) setError(t.pasteEmpty)
      return
    }
    if (silent) {
      // Автоподхват: не дёргаем сервер, если в буфере не учебный план.
      if (!/\d/.test(payload) || payload === lastPaste.current) return
      lastPaste.current = payload
    }
    setError('')
    setLoading(true)
    try {
      const { res, data } = await request({ html: payload })
      if (!res.ok || !data.semesters?.length) throw new Error(data.error || t.pasteEmpty)
      handleData(data)
    } catch (err) {
      if (!silent) setError(err.message || t.pasteEmpty)
    } finally {
      setLoading(false)
    }
  }

  // Возврат в калькулятор: пробуем забрать скопированное сами, без нажатий.
  useEffect(() => {
    if (!pasteOpen) return
    const grab = async () => {
      if (loading) return
      try {
        if (navigator.clipboard?.read) {
          const items = await navigator.clipboard.read()
          for (const type of ['text/html', 'text/plain']) {
            const item = items.find((i) => i.types.includes(type))
            if (item) {
              submitPaste(await (await item.getType(type)).text(), true)
              return
            }
          }
        } else if (navigator.clipboard?.readText) {
          submitPaste(await navigator.clipboard.readText(), true)
        }
      } catch {
        // Браузер не дал доступ к буферу — остаётся обычная вставка.
      }
    }
    grab()
    window.addEventListener('focus', grab)
    return () => window.removeEventListener('focus', grab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasteOpen, loading])

  // Телефон: страницу учебного плана удобнее сохранить в PDF и загрузить файлом.
  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setLoading(true)
    try {
      const text = await readGradesFile(file)
      await submitPaste(text)
    } catch (err) {
      setError(err.message || t.pasteEmpty)
    } finally {
      setLoading(false)
    }
  }

  const onPaste = (e) => {
    e.preventDefault()
    const cd = e.clipboardData
    // HTML сохраняет таблицы — по нему разбор точнее, текст берём запасным вариантом.
    submitPaste(cd.getData('text/html') || cd.getData('text/plain'))
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { res, data } = await request({ login: login.trim(), password })
      // У аккаунта нет пароля в LMS — подсказываем импорт без пароля.
      // LMS не пустил по паролю, но и не сказал, что он неверный (например, требует OneID), —
      // пишем, что вход временно недоступен, и сразу открываем импорт без пароля.
      if (data.unavailable || data.oneid || /oneid/i.test(data.error || '')) {
        setPasteOpen(true)
        throw new Error(t.errOneid)
      }
      if (res.status === 401) throw new Error(data.error || t.errWrong)
      if (res.status === 400) throw new Error(t.errEmpty)
      if (!res.ok || !data.semesters?.length) throw new Error(data.error || t.errServer)
      handleData(data)
    } catch (err) {
      setError(err.message || t.errServer)
    } finally {
      setLoading(false)
    }
  }

  const current = courses[sel]
  const courseGpa = current ? gpaOf(flatten(current)) : 0
  const totalList = courses.slice(0, sel + 1).flatMap(flatten)
  const totalGpa = gpaOf(totalList)
  const courseGraded = current ? flatten(current).filter((c) => c.grade).length : 0
  const totalGraded = totalList.filter((c) => c.grade).length

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{step === 'pick' ? t.modalPick : t.modalImport}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="×">
            ✕
          </button>
        </div>

        {step === 'loading' && (
          <div className="modal-body modal-loading">
            <div className="spinner" />
            <p className="modal-hint">{t.loading}</p>
          </div>
        )}

        {step === 'login' && (
          <form className="modal-body" onSubmit={submit}>
            <p className="modal-hint">{t.hintLogin}</p>
            <label className="fld">
              <span>{t.login}</span>
              <input
                type="text"
                autoFocus
                autoComplete="username"
                placeholder={t.loginPh}
                value={login}
                onChange={(e) => setLogin(e.target.value)}
              />
            </label>
            <label className="fld">
              <span>{t.password}</span>
              <div className="pass-wrap">
                <input
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder={t.passPh}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="pass-eye"
                  onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? t.hidePass : t.showPass}
                  aria-pressed={showPass}
                  title={showPass ? t.hidePass : t.showPass}
                >
                  {showPass ? (
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </label>

            {error && <div className="alert">{error}</div>}

            <button className="btn btn-accent full" type="submit" disabled={loading}>
              {loading ? t.submitting : t.submit}
            </button>

            <div className="or-line">
              <span>{t.or}</span>
            </div>
            {!pasteOpen && (
              <button
                type="button"
                className="btn btn-line full"
                onClick={() => {
                  setError('')
                  setPasteOpen(true)
                }}
              >
                {t.pasteLink}
              </button>
            )}

            {pasteOpen ? (
              <div className="paste-box">
                <p className="modal-hint">{t.pasteTitle}</p>
                <ol className="paste-steps">
                  <li>
                    <a href={PLAN_URL} target="_blank" rel="noreferrer">
                      {t.pasteStep1}
                    </a>
                  </li>
                  <li>{t.pasteStep2}</li>
                  <li>{t.pasteStep3}</li>
                </ol>
                <div
                  className="paste-zone"
                  contentEditable
                  suppressContentEditableWarning
                  onPaste={onPaste}
                  data-placeholder={t.pastePh}
                />
                {loading && <p className="modal-note">{t.submitting}</p>}

                <div className="or-line">
                  <span>{t.or}</span>
                </div>
                <label className="btn btn-line full file-pick">
                  {t.fileBtn}
                  <input
                    type="file"
                    onChange={onFile}
                  />
                </label>
                <p className="modal-note">{t.fileHint}</p>

              </div>
            ) : null}
            <a className="help-link" href="/help" target="_blank" rel="noreferrer">
              {t.helpLink}
            </a>
            <p className="modal-note">{t.privacy}</p>
          </form>
        )}

        {step === 'pick' && current && (
          <div className="modal-body">
            <div className="course-tabs">
              {courses.map((c, i) => (
                <button
                  key={c.course}
                  className={'course-tab' + (i === sel ? ' active' : '')}
                  onClick={() => setSel(i)}
                >
                  {t.courseLabel(c.course)}
                </button>
              ))}
            </div>

            <div className="gpa-summary">
              <div className="gpa-box">
                <span className="gpa-box-label">{t.courseGpa}</span>
                <span className="gpa-box-val">{courseGraded ? courseGpa.toFixed(2) : '—'}</span>
              </div>
              <div className="gpa-box accent">
                <span className="gpa-box-label">{t.totalGpa}</span>
                <span className="gpa-box-val">{totalGraded ? totalGpa.toFixed(2) : '—'}</span>
              </div>
            </div>

            <p className="modal-hint">{t.hintPick}</p>
            <div className="sem-list">
              {current.semesters.map((s) => {
                const g = gpaOf(s.courses)
                const gradedN = s.courses.filter((x) => x.grade).length
                return (
                  <button key={s.num} className="sem-item" onClick={() => onApply(s.courses)}>
                    <span className="sem-num">{s.num}</span>
                    <span className="sem-info">
                      <span className="sem-label">{t.semLabel(s.num)}</span>
                      <span className="sem-sub">
                        {t.subjects(s.courses.length)}
                        {gradedN < s.courses.length ? ` · ${t.graded(gradedN)}` : ''}
                      </span>
                    </span>
                    <span className="sem-gpa">{gradedN ? g.toFixed(2) : '—'}</span>
                  </button>
                )
              })}
            </div>

            <button className="btn btn-accent full" onClick={() => onApply(totalList)}>
              {t.importAll(current.course)}
            </button>

            <button
              className="modal-logout"
              onClick={() => {
                onLogout()
                setCourses([])
                setLogin('')
                setPassword('')
                setError('')
                setStep('login')
              }}
            >
              {t.logout}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
