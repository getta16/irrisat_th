import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'

import {
  PORT,
  FIELDS_FILE,
  GCS_BUCKET,
  GCS_FIELDS_OBJECT,
  AUTH_ENABLED,
  ALLOWED_EMAILS,
  ALLOWED_DOMAINS,
  LEGACY_OWNER_EMAIL,
} from './config.js'
import { initEarthEngine, geeStatus } from './services/gee.js'
import { initStore } from './services/store.js'
import { requireAuth } from './services/auth.js'
import authRouter from './routes/auth.js'
import importRouter from './routes/import.js'
import fieldsRouter from './routes/fields.js'
import analysisRouter from './routes/analysis.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(cors())
app.use(express.json({ limit: '25mb' }))

app.get('/api/status', (_req, res) => {
  res.json({ ok: true, gee: geeStatus(), auth: { enabled: AUTH_ENABLED }, time: new Date().toISOString() })
})

// ต้องอยู่ก่อน requireAuth เสมอ — ตอนอยู่หน้าล็อกอินยังไม่มี token จะเรียกเส้นทางนี้
app.use('/api/auth', authRouter)

// ข้อมูลแปลงและผลวิเคราะห์ต้องลงชื่อเข้าใช้ก่อน (เมื่อตั้ง GOOGLE_CLIENT_ID ไว้)
app.use('/api/import', requireAuth, importRouter)
app.use('/api/fields', requireAuth, fieldsRouter)
app.use('/api/analysis', requireAuth, analysisRouter)

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

// โหลดข้อมูลแปลงให้เสร็จก่อนเปิดรับคำขอ ไม่อย่างนั้นคำขอแรกจะเห็นรายการว่าง
const store = await initStore()

app.listen(PORT, () => {
  console.log(`\n  IRRISAT-THAI API   →  http://localhost:${PORT}`)
  console.log(
    `  ข้อมูลแปลง      →  ${store.where === 'gcs' ? `gs://${GCS_BUCKET}/${GCS_FIELDS_OBJECT}` : FIELDS_FILE} (${store.count} แปลง)`
  )

  if (store.claimed) {
    console.log(`                     โอนแปลงเก่า ${store.claimed} แปลงให้ ${LEGACY_OWNER_EMAIL} แล้ว`)
  }
  // เตือนให้เห็นชัด ๆ ไม่อย่างนั้นเจ้าของจะงงว่าแปลงเดิมหายไปไหนหลังเปิดใช้การล็อกอิน
  if (store.orphans && AUTH_ENABLED) {
    console.log(
      `\n  ⚠ มีแปลง ${store.orphans} แปลงที่ยังไม่มีเจ้าของ จึงยังไม่มีใครเห็น (ข้อมูลยังอยู่ครบ)` +
        '\n    ตั้ง LEGACY_OWNER_EMAIL=อีเมลของคุณ ใน .env แล้วรีสตาร์ต เพื่อโอนให้บัญชีนั้น'
    )
  }

  const allowed =
    ALLOWED_EMAILS.length || ALLOWED_DOMAINS.length
      ? [...ALLOWED_EMAILS, ...ALLOWED_DOMAINS.map((d) => `@${d}`)].join(', ')
      : 'ทุกบัญชี Google'
  console.log(
    AUTH_ENABLED
      ? `  ล็อกอิน Google  →  เปิดใช้งาน · แยกข้อมูลรายผู้ใช้ (อนุญาต: ${allowed})`
      : '  ล็อกอิน Google  →  ปิดอยู่ — เห็นแปลงทั้งหมดรวมกัน (ตั้ง GOOGLE_CLIENT_ID ใน .env เพื่อเปิด)'
  )
  initEarthEngine().then(() => {
    const s = geeStatus()
    if (s.ready) console.log(`  Earth Engine    →  พร้อมใช้งาน (project: ${s.project || 'default'})\n`)
    else console.log(`  Earth Engine    →  ยังไม่พร้อม: ${s.error}\n                     ระบบจะใช้ข้อมูลจำลองไปก่อน (ดู README)\n`)
  })
})
