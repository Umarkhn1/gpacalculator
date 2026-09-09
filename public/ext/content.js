// Работает на страницах lms.tuit.uz. После входа (в том числе через OneID)
// сам забирает учебный план и профиль и открывает GPA Calculator с оценками.
// Запросы идут с самого домена LMS, поэтому сессия студента подставляется браузером.

const SITE = 'https://gpa-calculator-tuit.netlify.app'
const ONCE_KEY = 'gpa-calc-imported'

const loggedIn = () => !/\/auth\/login|\/login\/oneid/.test(location.pathname)

async function grab() {
  const plan = await fetch('/student/study-plan', { credentials: 'include' })
  if (!plan.ok) throw new Error('LMS не отдал учебный план')
  const html = await plan.text()

  let info = ''
  try {
    const res = await fetch('/student/info', { credentials: 'include' })
    if (res.ok) info = await res.text()
  } catch {}

  const res = await fetch(`${SITE}/api/lms/import`, {
    method: 'POST',
    // text/plain — простой запрос, без предварительного OPTIONS.
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ html, info, handoff: true }),
  })
  const data = await res.json()
  if (!data.code) throw new Error(data.error || 'Не удалось разобрать оценки')
  return data.code
}

async function run(manual) {
  if (!loggedIn()) return
  // Автоматически — один раз за вход, чтобы не открывать вкладку на каждой странице.
  if (!manual && sessionStorage.getItem(ONCE_KEY)) return
  try {
    const code = await grab()
    sessionStorage.setItem(ONCE_KEY, '1')
    window.open(`${SITE}/#i=${code}`, '_blank')
  } catch (e) {
    if (manual) alert('GPA Calculator: ' + e.message)
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg === 'import-now') run(true)
})

run(false)
