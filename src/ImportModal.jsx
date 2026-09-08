import { useEffect, useState } from 'react'

const ENDPOINTS = ['/api/lms/import', '/.netlify/functions/lms-import']

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

const flatten = (course) => course.semesters.flatMap((s) => s.courses)

export default function ImportModal({ t, session, onClose, onApply, onAuth, onExpire }) {
  const [step, setStep] = useState(session ? 'loading' : 'login')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [courses, setCourses] = useState([])
  const [sel, setSel] = useState(0)

  const handleData = (data) => {
    const grouped = groupCourses(data.semesters)
    let def = grouped.length - 1
    grouped.forEach((c, i) => {
      if (c.semesters.some((s) => s.courses.some((x) => x.grade))) def = i
    })
    setCourses(grouped)
    setSel(def)
    onAuth(data.session, data.student)
    setStep('pick')
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

  // Автовход по сохранённой сессии — без повторного ввода пароля.
  useEffect(() => {
    if (!session) return
    let cancelled = false
    ;(async () => {
      try {
        const { res, data } = await request({ session })
        if (cancelled) return
        if (res.status === 401 || data.expired) {
          onExpire()
          setStep('login')
          return
        }
        if (!res.ok || !data.semesters?.length) throw new Error(data.error || t.errServer)
        handleData(data)
      } catch (err) {
        if (!cancelled) {
          onExpire()
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

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { res, data } = await request({ login: login.trim(), password })
      if (res.status === 401) throw new Error(t.errWrong)
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
              <input
                type="password"
                autoComplete="current-password"
                placeholder={t.passPh}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            {error && <div className="alert">{error}</div>}

            <button className="btn btn-accent full" type="submit" disabled={loading}>
              {loading ? t.submitting : t.submit}
            </button>
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
                onExpire()
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
