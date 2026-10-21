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
  API_KEYS,
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
import { requireApiKey } from './services/apiKey.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
// /api/v1 ไม่เปิด CORS — คีย์ต้องอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น ถ้าเปิดไว้ หน้าเว็บที่ไหนก็ได้
// ที่ได้คีย์ไปจะเรียกตรงจากเบราว์เซอร์ของคนอื่นได้ (header X-API-Key ทำให้ preflight ตก)
const corsAll = cors()
app.use((req, res, next) => (req.path.startsWith('/api/v1/') ? next() : corsAll(req, res, next)))
app.use(express.json({ limit: '25mb' }))

app.get('/api/status', (_req, res) => {
  res.json({ ok: true, gee: geeStatus(), auth: { enabled: AUTH_ENABLED }, time: new Date().toISOString() })
})

// ต้องอยู่ก่อน requireAuth เสมอ — ตอนอยู่หน้าล็อกอินยังไม่มี token จะเรียกเส้นทางนี้
app.use('/api/auth', authRouter)

// API ภายนอกใช้ API key แทนการล็อกอิน Google — จึงต้องอยู่ก่อน requireAuth เช่นกัน
app.use('/api/v1', requireApiKey, publicApiRouter)

// ข้อมูลแปลงและผลวิเคราะห์ต้องลงชื่อเข้าใช้ก่อน (เมื่อตั้ง GOOGLE_CLIENT_ID ไว้)
app.use('/api/import', requireAuth, importRouter)
app.use('/api/fields', requireAuth, fieldsRouter)
app.use('/api/analysis', requireAuth, analysisRouter)

// หน้าเว็บ "API ข้อมูลแปลง" — ให้ผู้ที่ล็อกอินแล้วลองเรียก API v1 กับแปลงของตัวเองได้
// โดยไม่ต้องเอา API key มาใส่ในเบราว์เซอร์ (ใช้ token ของ Google แทน คำตอบเหมือน /api/v1 ทุกอย่าง)
app.get('/api/portal/info', requireAuth, (req, res) => {
  const email = req.user?.email?.toLowerCase()
  res.json({
    email: req.user?.email ?? null,
    hasApiKey: !!email && [...API_KEYS.values()].some((e) => e.toLowerCase() === email),
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
    API_KEYS.size
      ? `  API ภายนอก      →  /api/v1 เปิดใช้งาน (${API_KEYS.size} คีย์: ${[...new Set(API_KEYS.values())].join(', ')})`
      : '  API ภายนอก      →  ปิดอยู่ (ตั้ง API_KEYS ใน .env เพื่อเปิด)'
  )
  initEarthEngine().then(() => {
    const s = geeStatus()
    if (s.ready) console.log(`  Earth Engine    →  พร้อมใช้งาน (project: ${s.project || 'default'})\n`)
    else console.log(`  Earth Engine    →  ยังไม่พร้อม: ${s.error}\n                     ระบบจะใช้ข้อมูลจำลองไปก่อน (ดู README)\n`)
  })
})
