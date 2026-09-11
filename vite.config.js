import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createBugReportHandler } from './server/bugReports.js'

// Keep mail configuration in the Node process. VITE_* remains reserved for
// public client configuration; reporting never exposes its destination or key.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const installReportApi = (server) => {
    const handler = createBugReportHandler({ env })
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== '/api/bug-report') return next()
      Promise.resolve(handler(req, res)).catch(() => {
        if (!res.headersSent) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: '신고를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }))
        } else res.end()
      })
    })
  }
  return {
    plugins: [react(), {
      name: 'local-bug-report-api',
      configureServer: installReportApi,
      configurePreviewServer: installReportApi,
    }],
  }
})
