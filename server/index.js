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
  PUBLIC_API_OWNER,
  API_RATE_PER_MIN,
  API_MAX_RANGE_DAYS,
} from './config.js'
import { initEarthEngine, geeStatus } from './services/gee.js'
import { initStore } from './services/store.js'
import { requireAuth, ownerOf } from './services/auth.js'
import authRouter from './routes/auth.js'
import importRouter from './routes/import.js'
import fieldsRouter from './routes/fields.js'
import analysisRouter from './routes/analysis.js'
import publicApiRouter from './routes/publicApi.js'
import { publicApiAccess } from './services/publicAccess.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
// Cloud Run อยู่หลัง load balancer หนึ่งชั้น — ให้ req.ip เป็น IP จริงของผู้เรียก (ใช้จำกัดจำนวนคำขอของ /api/v1)
app.set('trust proxy', 1)
// /api/v1 ไม่เปิด CORS — ไม่ให้หน้าเว็บอื่นเรียกจากเบราว์เซอร์ของผู้ชมจนโควตา Earth Engine หมด
const corsAll = cors()
app.use((req, res, next) => (req.path.startsWith('/api/v1/') ? next() : corsAll(req, res, next)))
app.use(express.json({ limit: '25mb' }))

app.get('/api/status', (_req, res) => {
  res.json({ ok: true, gee: geeStatus(), auth: { enabled: AUTH_ENABLED }, time: new Date().toISOString() })
})

// ต้องอยู่ก่อน requireAuth เสมอ — ตอนอยู่หน้าล็อกอินยังไม่มี token จะเรียกเส้นทางนี้
app.use('/api/auth', authRouter)

// API ภายนอกไม่ต้องล็อกอินและไม่ต้องใช้คีย์ เห็นเฉพาะแปลงของ PUBLIC_API_OWNER — จึงต้องอยู่ก่อน requireAuth เช่นกัน
app.use('/api/v1', publicApiAccess, publicApiRouter)

// ข้อมูลแปลงและผลวิเคราะห์ต้องลงชื่อเข้าใช้ก่อน (เมื่อตั้ง GOOGLE_CLIENT_ID ไว้)
app.use('/api/import', requireAuth, importRouter)
app.use('/api/fields', requireAuth, fieldsRouter)
app.use('/api/analysis', requireAuth, analysisRouter)

// หน้าเว็บ "API ข้อมูลแปลง" — ให้ผู้ที่ล็อกอินแล้วลองเรียก API v1 กับแปลงของตัวเองได้
// (ใช้ token ของ Google คำตอบเหมือน /api/v1 ทุกอย่าง)
app.get('/api/portal/info', requireAuth, (req, res) => {
  res.json({
    email: req.user?.email ?? null,
    publicApiOwner: PUBLIC_API_OWNER,
    rateLimitPerMin: API_RATE_PER_MIN,
    maxRangeDays: API_MAX_RANGE_DAYS,
  })
})
app.use(
  '/api/portal',
  requireAuth,
  (req, _res, next) => {
    req.apiOwner = ownerOf(req)
    next()
  },
  publicApiRouter
)

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
  console.log(
    `  API ภายนอก      →  /api/v1 เปิดใช้งาน ไม่ต้องใช้คีย์ (แปลงของ ${PUBLIC_API_OWNER})`
  )
  initEarthEngine().then(() => {
    const s = geeStatus()
    if (s.ready) console.log(`  Earth Engine    →  พร้อมใช้งาน (project: ${s.project || 'default'})\n`)
    else console.log(`  Earth Engine    →  ยังไม่พร้อม: ${s.error}\n                     ระบบจะใช้ข้อมูลจำลองไปก่อน (ดู README)\n`)
  })
})
