import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Локально запускаем ту же Netlify-функцию, что и на деплое, чтобы `npm run dev`
// поддерживал импорт из LMS без отдельного сервера и без netlify-cli.
function lmsDevApi() {
  return {
    name: 'lms-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/lms/import', (req, res) => {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', async () => {
          try {
            const url = pathToFileURL(
              path.resolve('netlify/functions/lms-import.mjs'),
            ).href
            const { handler } = await import(url + `?t=${Date.now()}`)
            const result = await handler({ httpMethod: req.method, body })
            res.statusCode = result.statusCode
            for (const [k, v] of Object.entries(result.headers || {})) res.setHeader(k, v)
            res.end(result.body)
          } catch (e) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Ошибка функции: ' + e.message }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), lmsDevApi()],
  build: {
    outDir: 'dist',
  },
})
