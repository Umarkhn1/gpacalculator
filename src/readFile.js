// Чтение файла с оценками: PDF (телефон сохраняет страницу LMS печатью),
// либо сохранённая страница HTML, либо просто текст.
// Из PDF собираем строки по координатам — ячейки разделяем табом, как в таблице.

const PDFJS_VERSION = '4.6.82'
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`

let pdfjsPromise = null
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ `${PDFJS_BASE}/pdf.min.mjs`).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`
      return lib
    })
  }
  return pdfjsPromise
}

async function pdfToText(file) {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const lines = []
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n)
    const { items } = await page.getTextContent()
    // Элементы одной строки имеют почти одинаковую координату Y.
    const rows = new Map()
    for (const it of items) {
      const text = (it.str || '').trim()
      if (!text) continue
      const y = Math.round(it.transform[5])
      const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 3)
      const row = rows.get(key ?? y) || []
      row.push({ x: it.transform[4], text })
      rows.set(key ?? y, row)
    }
    ;[...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .forEach(([, row]) => {
        lines.push(
          row
            .sort((a, b) => a.x - b.x)
            .map((c) => c.text)
            .join('\t'),
        )
      })
  }
  return lines.join('\n')
}

// Android сохраняет страницу как .mhtml: тело закодировано quoted-printable,
// раскодируем побайтно и читаем как UTF-8.
async function mhtmlToHtml(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const out = []
  const hex = (c) => {
    const v = parseInt(String.fromCharCode(c), 16)
    return Number.isNaN(v) ? -1 : v
  }
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] !== 0x3d) {
      out.push(bytes[i])
      continue
    }
    // «=» в конце строки — перенос, «=XX» — байт.
    if (bytes[i + 1] === 0x0d && bytes[i + 2] === 0x0a) {
      i += 2
    } else if (bytes[i + 1] === 0x0a) {
      i += 1
    } else {
      const hi = hex(bytes[i + 1])
      const lo = hex(bytes[i + 2])
      if (hi >= 0 && lo >= 0) {
        out.push(hi * 16 + lo)
        i += 2
      } else {
        out.push(bytes[i])
      }
    }
  }
  return new TextDecoder('utf-8').decode(new Uint8Array(out))
}

// Сохранённая страница весит мегабайты (картинки, стили), а функции можно отправить
// не больше 6 МБ. Оставляем только таблицы учебного плана и имя студента.
function onlyTables(html) {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi)
  if (!tables) return html
  const name = html.match(/<[^>]*si-student-name[^>]*>[^<]*</)
  return (name ? name[0] : '') + tables.join('\n')
}

// Safari сохраняет «Веб-архив» (.webarchive) — это бинарный plist, но HTML страницы
// лежит в нём как есть, поэтому достаточно прочитать байты как UTF-8.
async function webarchiveToHtml(file) {
  return new TextDecoder('utf-8').decode(new Uint8Array(await file.arrayBuffer()))
}

export async function readGradesFile(file) {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return pdfToText(file)
  if (name.endsWith('.mhtml') || name.endsWith('.mht')) return onlyTables(await mhtmlToHtml(file))
  if (name.endsWith('.webarchive')) return onlyTables(await webarchiveToHtml(file))
  const raw = await file.text()
  // Файл без расширения, но по содержимому MHTML — раскодируем так же.
  if (/^(From|MIME-Version):/m.test(raw.slice(0, 2000)) && /quoted-printable/i.test(raw.slice(0, 20000))) {
    return onlyTables(await mhtmlToHtml(file))
  }
  // HTML и текст: у текста таблиц нет — он уйдёт как есть.
  return onlyTables(raw)
}
