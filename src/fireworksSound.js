// Звук салюта синтезируется Web Audio — без файлов: свист взлёта, разрыв с раскатом
// и эхом, треск. Каждый звук ставится в стереопанораму по месту разрыва (слева/справа).
//
// Разрыв намеренно собран без тонального генератора: синус с падающей высотой звучит
// как бас-барабан. Настоящий салют — это мгновенный широкополосный хлопок, темнеющий
// раскат и отзвук от окружения; дальние залпы тише, глуше и доходят позже вспышки.

let ctx = null
let master = null
let noiseBuffer = null
let reverb = null
let saturator = null

// Браузеры дают включить звук только в ответ на действие пользователя,
// поэтому вызывать в обработчике клика — тогда аудио разблокируется везде, включая Safari.
export function unlockAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx) return null
  if (!ctx) {
    ctx = new AudioCtx()
    // Компрессор, чтобы наложение нескольких залпов не хрипело.
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.ratio.value = 6
    comp.attack.value = 0.002
    comp.release.value = 0.25
    master = ctx.createGain()
    master.gain.value = 0.6
    master.connect(comp).connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

export const getAudio = () => (ctx && ctx.state !== 'closed' ? ctx : null)

function noise() {
  if (!noiseBuffer) {
    const length = ctx.sampleRate * 2
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  }
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer
  return src
}

// Уличный отзвук: затухающий шум плюс несколько отражений «от зданий».
// Хвост тёмный — высокие частоты вдали гаснут первыми.
function getReverb() {
  if (!reverb) {
    const rate = ctx.sampleRate
    const ir = ctx.createBuffer(2, Math.round(rate * 3.2), rate)
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch)
      for (let i = 0; i < d.length; i++) {
        const t = i / rate
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t / 0.8) * Math.min(1, t / 0.015)
      }
      for (const [at, amp] of [
        [0.17, 0.55],
        [0.39, 0.38],
        [0.74, 0.24],
        [1.2, 0.14],
      ]) {
        const from = Math.round((at + ch * 0.017) * rate)
        const len = Math.round(rate * 0.04)
        for (let k = 0; k < len && from + k < d.length; k++) {
          d[from + k] += (Math.random() * 2 - 1) * amp * Math.exp(-k / (rate * 0.01))
        }
      }
    }
    reverb = ctx.createConvolver()
    reverb.buffer = ir
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 1500
    const wet = ctx.createGain()
    wet.gain.value = 0.85
    reverb.connect(tone).connect(wet).connect(master)
  }
  return reverb
}

// Мягкое насыщение — хлопок становится плотным «ударом по воздуху», а не шипением.
function getSaturator() {
  if (!saturator) {
    const curve = new Float32Array(1024)
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1
      curve[i] = Math.tanh(3 * x) / Math.tanh(3)
    }
    saturator = curve
  }
  const shaper = ctx.createWaveShaper()
  shaper.curve = saturator
  shaper.oversample = '2x'
  return shaper
}

// Сухой сигнал в панораме + отправка в отзвук.
function output(pan, wetAmount) {
  const gain = ctx.createGain()
  if (ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner()
    panner.pan.value = pan
    gain.connect(panner).connect(master)
  } else {
    gain.connect(master)
  }
  if (wetAmount) {
    const send = ctx.createGain()
    send.gain.value = wetAmount
    gain.connect(send).connect(getReverb())
  }
  return gain
}

// Огибающая: быстрая атака и экспоненциальный спад.
function envelope(param, t, peak, attack, release) {
  param.setValueAtTime(0.0001, t)
  param.exponentialRampToValueAtTime(peak, t + attack)
  param.exponentialRampToValueAtTime(0.0001, t + attack + release)
}

function play(src, t, length) {
  src.start(t, Math.random())
  src.stop(t + length)
}

// Свист взлёта: шум через узкий полосовой фильтр, частота растёт вместе с ракетой.
export function playLaunch(pan, duration) {
  if (!getAudio()) return
  const t = ctx.currentTime
  const src = noise()
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = 9
  band.frequency.setValueAtTime(700, t)
  band.frequency.exponentialRampToValueAtTime(2600, t + duration)
  const gain = ctx.createGain()
  envelope(gain.gain, t, 0.06, 0.12, duration)
  src.connect(band).connect(gain).connect(output(pan, 0.25))
  play(src, t, duration + 0.2)
}

// Разрыв: хлопок + раскат + низ, всё через отзвук. Чем «дальше» залп —
// тем позже приходит звук, тем он тише и глуше, а эха в нём больше.
export function playBoom(pan, power = 1) {
  if (!getAudio()) return
  const distance = Math.random()
  const t = ctx.currentTime + 0.06 + distance * 0.22
  const bus = ctx.createGain()
  bus.gain.value = power * (1 - distance * 0.35)
  const air = ctx.createBiquadFilter()
  air.type = 'lowpass'
  air.frequency.value = 6000 - distance * 3000
  bus.connect(air).connect(output(pan, 0.5 + distance * 0.4))

  // 1) Хлопок: мгновенный широкополосный треск — именно он отличает салют от барабана.
  const crack = noise()
  const crackHigh = ctx.createBiquadFilter()
  crackHigh.type = 'highpass'
  crackHigh.frequency.value = 650
  const crackGain = ctx.createGain()
  envelope(crackGain.gain, t, 0.95, 0.0015, 0.1)
  crack.connect(crackHigh).connect(getSaturator()).connect(crackGain).connect(bus)
  play(crack, t, 0.2)

  // 2) Раскат: шум, который быстро темнеет и долго затухает.
  const body = noise()
  const bodyLow = ctx.createBiquadFilter()
  bodyLow.type = 'lowpass'
  bodyLow.Q.value = 0.5
  bodyLow.frequency.setValueAtTime(3200, t)
  bodyLow.frequency.exponentialRampToValueAtTime(170, t + 1.6)
  const bodyGain = ctx.createGain()
  envelope(bodyGain.gain, t, 0.5, 0.004, 1.9)
  body.connect(bodyLow).connect(bodyGain).connect(bus)
  play(body, t, 2.1)

  // 3) Низ — не тон, а глубоко отфильтрованный шум: даёт вес без «бочки».
  const sub = noise()
  const subLow = ctx.createBiquadFilter()
  subLow.type = 'lowpass'
  subLow.frequency.value = 110
  subLow.Q.value = 0.7
  const subGain = ctx.createGain()
  envelope(subGain.gain, t, 0.9, 0.01, 0.8)
  sub.connect(subLow).connect(subGain).connect(bus)
  play(sub, t, 1)
}

// Треск: россыпь коротких щелчков после разрыва, тоже с отзвуком.
export function playCrackle(pan) {
  if (!getAudio()) return
  const start = ctx.currentTime + 0.45
  const out = output(pan, 0.35)
  const count = 14 + Math.floor(Math.random() * 12)
  for (let i = 0; i < count; i++) {
    const t = start + Math.random() * 0.8
    const src = noise()
    const high = ctx.createBiquadFilter()
    high.type = 'highpass'
    high.frequency.value = 2600
    const gain = ctx.createGain()
    envelope(gain.gain, t, 0.07 + Math.random() * 0.05, 0.002, 0.03)
    src.connect(high).connect(gain).connect(out)
    play(src, t, 0.05)
  }
}
