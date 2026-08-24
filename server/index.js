import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'

import { PORT } from './config.js'
import { initEarthEngine, geeStatus } from './services/gee.js'
import importRouter from './routes/import.js'
import fieldsRouter from './routes/fields.js'
import analysisRouter from './routes/analysis.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(cors())
app.use(express.json({ limit: '25mb' }))

app.get('/api/status', (_req, res) => {
  res.json({ ok: true, gee: geeStatus(), time: new Date().toISOString() })
})

app.use('/api/import', importRouter)
app.use('/api/fields', fieldsRouter)
app.use('/api/analysis', analysisRouter)

// เสิร์ฟหน้าเว็บที่ build แล้ว (ถ้ามี) — ใช้ตอนรัน production ด้วยคำสั่งเดียว
const clientDist = path.join(__dirname, '..', 'client', 'dist')
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')))
}

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์', detail: String(err?.message || err) })
})

app.listen(PORT, () => {
  console.log(`\n  IrriSAT-TH API  →  http://localhost:${PORT}`)
  initEarthEngine().then(() => {
    const s = geeStatus()
    if (s.ready) console.log(`  Earth Engine    →  พร้อมใช้งาน (project: ${s.project || 'default'})\n`)
    else console.log(`  Earth Engine    →  ยังไม่พร้อม: ${s.error}\n                     ระบบจะใช้ข้อมูลจำลองไปก่อน (ดู README)\n`)
  })
})
