import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Локально запускаем те же Netlify-функции, что и на деплое, чтобы `npm run dev`
// поддерживал импорт из LMS и страницу статистики без netlify-cli.
const ROUTES = {
  '/api/lms/import': 'lms-import',
  '/api/s-165b0620afce': 's-165b0620afce',
}

function netlifyDevApi() {
  return {
    name: 'netlify-dev-api',
    configureServer(server) {
      // Красивый путь страницы статистики, как на Netlify.
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/165b0620afce') req.url = '/165b0620afce.html'
        next()
      })

      for (const [route, fn] of Object.entries(ROUTES)) {
        server.middlewares.use(route, (req, res) => {
          let body = ''
          req.on('data', (c) => (body += c))
          req.on('end', async () => {
            try {
              const url = pathToFileURL(
                path.resolve(`netlify/functions/${fn}.mjs`),
              ).href
              const { handler } = await import(url + `?t=${Date.now()}`)
              const full = new URL(req.originalUrl || route, 'http://localhost')
              const result = await handler({
                httpMethod: req.method,
                body,
                headers: req.headers,
                rawUrl: full.href,
                queryStringParameters: Object.fromEntries(full.searchParams),
              })
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
      }
    },
  }
}

export default defineConfig({
  base: '/',
  plugins: [react(), netlifyDevApi()],
  build: {
    outDir: 'dist',
  },
})
