import { useEffect, useRef } from 'react'
import { playBoom, playCrackle, playLaunch } from './fireworksSound.js'

// Салют по бокам основного экрана. Ракета взлетает с искрящим шлейфом, на высоте —
// вспышка и разрыв. Искры летят сферой, тормозятся воздухом, падают, остывают
// (темнеют, хризантема желтеет) и мерцают перед тем, как погаснуть.
// Три фигурных залпа в боковых полях: лайк, знак бесконечности и надпись-похвала.
// Всё шоу — ровно 5 секунд: запуски первые ~3.3 с, затем плавное затухание.
const HUES = [352, 45, 145, 192, 270, 22, 318, 212]
const TYPES = ['peony', 'peony', 'chrysanthemum', 'willow', 'ring']
const LAUNCH_MS = 3300
const FADE_FROM = 4500
const TOTAL_MS = 5000
// Фигурные ракеты: когда (мс от начала), на какую сторону (0/1) и сколько сторона занята.
// «Молодец» — на той же стороне, где раньше догорит лайк.
const SPECIALS = [
  { at: 300, kind: 'like', side: 0, busy: 3000 },
  { at: 700, kind: 'infinity', side: 1, busy: 3000 },
  { at: 2100, kind: 'word', side: 0, busy: 2900 },
]
// Фигурные искры тормозятся так, что останавливаются ровно в своей точке фигуры:
// при торможении DRAG за 16 мс путь до остановки равен скорость × SETTLE.
const DRAG = 0.94
const SETTLE = -16 / Math.log(DRAG)
// Контур «палец вверх» (иконка Lucide thumbs-up, лицензия ISC), сетка 24×24.
const LIKE_PATHS = [
  'M7 10v12',
  'M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z',
]
const rand = (a, b) => a + Math.random() * (b - a)
const pick = (list) => list[Math.floor(Math.random() * list.length)]

// Лемниската Бернулли — знак бесконечности; две близкие линии для толщины.
function infinityPoints(size) {
  const pts = []
  const n = 72
  for (const k of [1, 0.9]) {
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2
      const d = 1 + Math.sin(t) ** 2
      pts.push([(size * k * Math.cos(t)) / d, (size * k * Math.sin(t) * Math.cos(t)) / d])
    }
  }
  return pts
}

// Рисуем фигуру на скрытом холсте и берём закрашенные пиксели по ровной сетке.
function sample(draw, w, h, spacing, limit) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  draw(g)
  const data = g.getImageData(0, 0, w, h).data
  let step = spacing
  let pts
  do {
    pts = []
    for (let y = step / 2; y < h; y += step) {
      for (let x = step / 2; x < w; x += step) {
        if (data[(Math.floor(y) * w + Math.floor(x)) * 4 + 3] > 128) pts.push([x - w / 2, y - h / 2])
      }
    }
    step += 0.5
  } while (pts.length > limit)
  return pts
}

// Надпись: рисуем крупно, затем уменьшаем до ширины бокового поля. Буквы с разрядкой,
// а искры стоят плотно — штрихи получаются сплошной «неоновой» линией и читаются даже мелко.
function wordPoints(word, maxWidth) {
  const font = '800 110px "Segoe UI", Roboto, sans-serif'
  const tracking = 14
  const probe = document.createElement('canvas').getContext('2d')
  probe.font = font
  const w = Math.ceil(probe.measureText(word).width + tracking * word.length) + 20
  const h = 150
  const scale = Math.min(1, maxWidth / w)
  const spacing = (maxWidth < 260 ? 2.8 : 3.6) / scale
  return sample(
    (g) => {
      g.font = font
      g.textBaseline = 'middle'
      g.fillStyle = '#fff'
      // Разрядка вручную — буква за буквой, чтобы работало в любом браузере.
      let x = 10
      for (const ch of word) {
        g.fillText(ch, x, h / 2)
        x += g.measureText(ch).width + tracking
      }
    },
    w,
    h,
    spacing,
    900,
  ).map(([x, y]) => [x * scale, y * scale])
}

// Лайк: контур иконки, обведённый линией, — как у знака бесконечности, из «нити» искр.
function likePoints(size) {
  const pad = 8
  const s = size / 24
  return sample(
    (g) => {
      g.translate(pad, pad)
      g.scale(s, s)
      g.lineWidth = 2.1
      g.lineCap = 'round'
      g.lineJoin = 'round'
      g.strokeStyle = '#fff'
      for (const d of LIKE_PATHS) g.stroke(new Path2D(d))
    },
    Math.ceil(size + pad * 2),
    Math.ceil(size + pad * 2),
    3.4,
    420,
  )
}

export default function Fireworks({ word, onDone }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let width = 0
    let height = 0
    let zones = []

    // Боковые поля — всё, что левее и правее колонки калькулятора.
    const layout = () => {
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const page = document.querySelector('.page')?.getBoundingClientRect()
      const side = page && page.left > 140 ? page.left : width * 0.18
      zones = [
        [0, side],
        [width - side, width],
      ]
    }
    layout()
    window.addEventListener('resize', layout)

    const rockets = []
    const sparks = []
    const flashes = []
    // Стороны для фигур каждый раз случайно меняются местами.
    const flip = Math.random() < 0.5 ? 1 : 0
    const specials = SPECIALS.map((s) => ({ ...s, side: s.side ^ flip }))
    // Пока на стороне горит фигура, обычные залпы там рвутся ниже, чтобы её не заслонять.
    const busyUntil = [0, 0]
    const started = performance.now()
    let last = started
    let nextLaunch = started
    let side = 0
    let frame = 0
    // Сколько ракет ушло на каждую сторону — обычные залпы выравнивают счёт после фигурных.
    const count = [0, 0]

    const panOf = (x) => Math.max(-0.9, Math.min(0.9, (x / width) * 2 - 1))
    const spark = (x, y, o) =>
      sparks.push({ x, y, life: 0, drag: 0.976, grav: 0.00018, streak: 1, light: 68, flicker: true, ...o })

    const rocket = (x, peak, g, extra) => {
      // Скорость подобрана так, чтобы ракета остановилась ровно на высоте разрыва.
      const vy = -Math.sqrt(2 * g * (height + 10 - peak))
      rockets.push({ x, y: height + 10, vx: rand(-0.015, 0.015), vy, g, hue: pick(HUES), crackle: false, ...extra })
      count[x < width / 2 ? 0 : 1]++
      if (window.__fwDebug) window.__fwDebug.push(x < width / 2 ? 'L' : 'R')
      playLaunch(panOf(x), -vy / g / 1000)
    }

    const launch = (now) => {
      // Баланс: ракета — на ту сторону, где залпов пока меньше (при равенстве — по очереди).
      const s = count[0] === count[1] ? side : count[0] < count[1] ? 0 : 1
      side = 1 - s
      const [from, to] = zones[s]
      const zone = to - from
      const busy = busyUntil[s] > now
      rocket(from + zone * rand(0.3, 0.7), busy ? rand(height * 0.55, height * 0.72) : rand(height * 0.12, height * 0.45), 0.0009, {
        type: pick(TYPES),
        radius: Math.max(80, Math.min(busy ? 140 : 230, zone * (busy ? 0.55 : 0.8))),
        crackle: Math.random() < 0.35,
      })
    }

    const launchSpecial = ({ kind, side: s, busy }, now) => {
      busyUntil[s] = now + busy
      const [from, to] = zones[s]
      const zone = to - from
      const center = (from + to) / 2
      if (kind === 'infinity') {
        const size = Math.max(60, Math.min(125, zone * 0.42))
        rocket(center, rand(height * 0.24, height * 0.32), 0.0009, { type: 'shape', shape: infinityPoints(size), kind, radius: size })
      } else if (kind === 'like') {
        const size = Math.max(90, Math.min(150, zone * 0.62))
        rocket(center, rand(height * 0.24, height * 0.3), 0.0009, { type: 'shape', shape: likePoints(size), kind, radius: size / 2 })
      } else {
        // Надпись — на краю: целиком внутри бокового поля, по его центру.
        const text = (word || '').toLocaleUpperCase()
        if (!text) return
        const textWidth = Math.min(340, zone * 0.96)
        // Ракета быстрее обычной, чтобы надпись успели прочитать до конца шоу.
        rocket(center, rand(height * 0.22, height * 0.28), 0.0016, {
          type: 'shape',
          shape: wordPoints(text, textWidth),
          kind,
          radius: textWidth / 2,
        })
      }
    }

    const shapeBurst = (r, elapsed) => {
      const n = r.shape.length
      // Надпись держится до конца шоу, остальные фигуры — ~1.7 с.
      const ttl = r.kind === 'word' ? Math.max(1500, TOTAL_MS - elapsed) : 1700
      r.shape.forEach(([dx, dy], i) => {
        spark(r.x, r.y, {
          vx: dx / SETTLE,
          vy: dy / SETTLE,
          drag: DRAG,
          grav: 0.000012,
          ttl: ttl * rand(0.94, 1),
          hold: 0.72,
          // Бесконечность переливается вдоль линии, лайк — синий, надпись — тёплое золото.
          hue:
            r.kind === 'word' ? 45 + rand(-3, 3) : r.kind === 'like' ? 212 + rand(-4, 4) : (185 + (i / n) * 140) % 360,
          light: r.kind === 'infinity' ? 66 : 70,
          size: r.kind === 'word' ? rand(1.8, 2.1) : rand(1.8, 2.4),
          // Короткий штрих: пока летит — искра, когда встала на место — чёткая точка.
          streak: 0.6,
          flicker: false,
        })
      })
    }

    const explode = (r, elapsed) => {
      flashes.push({ x: r.x, y: r.y, life: 0, ttl: 180, size: (r.radius || 120) * 0.6 })
      const pan = panOf(r.x)
      if (r.type === 'shape') {
        shapeBurst(r, elapsed)
        playBoom(pan, 1.2)
        playCrackle(pan)
        return
      }
      // Такая начальная скорость с учётом сопротивления воздуха даёт разлёт примерно на radius.
      const v = r.radius / 560
      if (r.type === 'ring') {
        // Кольцо под случайным наклоном — выглядит объёмным.
        const n = 64
        const tilt = rand(0, Math.PI)
        const squash = rand(0.3, 1)
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2
          const cx = Math.cos(a)
          const cy = Math.sin(a) * squash
          spark(r.x, r.y, {
            vx: (cx * Math.cos(tilt) - cy * Math.sin(tilt)) * v,
            vy: (cx * Math.sin(tilt) + cy * Math.cos(tilt)) * v,
            ttl: rand(1100, 1450),
            hue: r.hue,
            size: rand(1.5, 2.1),
            grav: 0.00014,
            crackle: r.crackle,
          })
        }
      } else {
        const willow = r.type === 'willow'
        const chrys = r.type === 'chrysanthemum'
        const second = pick(HUES)
        const n = willow ? 70 : Math.round(rand(85, 115))
        for (let i = 0; i < n; i++) {
          // Точка на сфере в проекции — у края гуще, как у настоящего «пиона».
          const theta = Math.random() * Math.PI * 2
          const z = rand(-1, 1)
          const ring = Math.sqrt(1 - z * z)
          const speed = v * rand(0.88, 1.02) * (willow ? 0.85 : 1)
          spark(r.x, r.y, {
            vx: Math.cos(theta) * ring * speed,
            vy: Math.sin(theta) * ring * speed,
            ttl: willow ? rand(1800, 2400) : rand(1100, 1650),
            hue: willow ? 42 : Math.random() < 0.8 ? r.hue : second,
            light: willow ? 62 : 68,
            size: willow ? rand(1.1, 1.5) : rand(1.3, 2.1),
            drag: willow ? 0.984 : chrys ? 0.978 : 0.975,
            grav: willow ? 0.00034 : 0.00018,
            streak: willow ? 4 : chrys ? 3 : 1.4,
            warm: chrys,
            crackle: !willow && r.crackle,
          })
        }
      }
      playBoom(pan, r.type === 'willow' ? 0.8 : 1)
      if (r.crackle && r.type !== 'willow') playCrackle(pan)
    }

    const tick = (now) => {
      const dt = Math.min(now - last, 40)
      last = now
      const elapsed = now - started
      const fade = elapsed > FADE_FROM ? Math.max(0, 1 - (elapsed - FADE_FROM) / (TOTAL_MS - FADE_FROM)) : 1

      for (const s of specials) {
        if (!s.done && elapsed >= s.at) {
          s.done = true
          launchSpecial(s, now)
        }
      }
      if (elapsed < LAUNCH_MS && now >= nextLaunch) {
        launch(now)
        nextLaunch = now + rand(280, 450)
      }

      // Прошлый кадр не стираем целиком, а приглушаем — от искр остаются шлейфы.
      ctx.globalCompositeOperation = 'destination-out'
      ctx.globalAlpha = 1
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
      ctx.fillRect(0, 0, width, height)
      ctx.globalCompositeOperation = 'lighter'
      ctx.lineCap = 'round'

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]
        const px = r.x
        const py = r.y
        r.vy += r.g * dt
        r.x += r.vx * dt
        r.y += r.vy * dt
        // Шлейф ракеты: тёплые искорки, осыпающиеся вниз.
        if (Math.random() < 0.9) {
          spark(r.x, r.y, {
            vx: rand(-0.025, 0.025),
            vy: rand(0.01, 0.05),
            ttl: rand(260, 460),
            hue: 32,
            light: 62,
            size: rand(0.9, 1.3),
            drag: 0.94,
            grav: 0.00025,
          })
        }
        ctx.globalAlpha = fade
        ctx.strokeStyle = 'hsl(45, 100%, 88%)'
        ctx.lineWidth = 2.2
        ctx.beginPath()
        ctx.moveTo(px, py + 6)
        ctx.lineTo(r.x, r.y)
        ctx.stroke()
        if (r.vy >= -0.03) {
          explode(r, elapsed)
          rockets.splice(i, 1)
        }
      }

      // Вспышка в момент разрыва.
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i]
        f.life += dt
        const t = f.life / f.ttl
        if (t >= 1) {
          flashes.splice(i, 1)
          continue
        }
        const radius = f.size * (0.6 + t)
        const glow = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, radius)
        glow.addColorStop(0, `rgba(255, 244, 225, ${0.55 * (1 - t) * fade})`)
        glow.addColorStop(1, 'rgba(255, 244, 225, 0)')
        ctx.globalAlpha = 1
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(f.x, f.y, radius, 0, Math.PI * 2)
        ctx.fill()
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]
        s.life += dt
        if (s.life >= s.ttl) {
          // Потрескивание: догорающая искра рассыпается на пару белых искорок.
          if (s.crackle && Math.random() < 0.5) {
            for (let j = 0; j < 2; j++) {
              spark(s.x, s.y, {
                vx: rand(-0.06, 0.06),
                vy: rand(-0.06, 0.06),
                ttl: rand(120, 240),
                hue: 50,
                light: 94,
                size: 0.9,
                drag: 0.94,
                grav: 0.0001,
                flicker: false,
              })
            }
          }
          sparks.splice(i, 1)
          continue
        }
        const k = Math.pow(s.drag, dt / 16)
        s.vx *= k
        s.vy = s.vy * k + s.grav * dt
        s.x += s.vx * dt
        s.y += s.vy * dt
        const t = s.life / s.ttl
        // Мерцание перед угасанием.
        if (s.flicker && t > 0.62 && Math.random() < 0.35) continue
        // Фигура держится ярко, а гаснет только в конце; обычные искры гаснут сразу.
        const alpha = s.hold
          ? (t < s.hold ? 1 : Math.pow((1 - t) / (1 - s.hold), 1.25)) * (0.9 + Math.random() * 0.1)
          : Math.pow(1 - t, 1.25)
        const hue = s.warm && t > 0.45 ? 40 : s.hue
        const light = t < 0.07 ? 94 : s.light - 14 * t
        ctx.globalAlpha = alpha * fade
        ctx.strokeStyle = `hsl(${hue}, 100%, ${light}%)`
        ctx.lineWidth = s.size * (1 - t * 0.45)
        ctx.beginPath()
        ctx.moveTo(s.x - s.vx * 16 * s.streak, s.y - s.vy * 16 * s.streak)
        ctx.lineTo(s.x, s.y)
        ctx.stroke()
        // Свежие искры с мягким ореолом.
        if (t < 0.22) {
          ctx.globalAlpha = 0.14 * (1 - t / 0.22) * fade
          ctx.fillStyle = `hsl(${hue}, 100%, 70%)`
          ctx.beginPath()
          ctx.arc(s.x, s.y, s.size * 3.2, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1

      if (elapsed >= TOTAL_MS) {
        onDone()
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', layout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <canvas ref={canvasRef} className="fireworks" aria-hidden="true" />
}
