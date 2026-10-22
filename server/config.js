import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true })

export const DATA_DIR = path.join(__dirname, 'data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

export const PORT = Number(process.env.PORT || 5174)
export const FIELDS_FILE = path.join(DATA_DIR, 'fields.json')

// ── Google Earth Engine ────────────────────────────────────────────────
// เลือกวิธียืนยันตัวตนอย่างใดอย่างหนึ่ง:
//   1) GEE_SERVICE_ACCOUNT_KEY  = path ไปยังไฟล์ .json ของ service account
//   2) GEE_SERVICE_ACCOUNT_JSON = เนื้อหา JSON ทั้งก้อน (สะดวกตอน deploy)
export const GEE_KEY_PATH = process.env.GEE_SERVICE_ACCOUNT_KEY || ''
export const GEE_KEY_JSON = process.env.GEE_SERVICE_ACCOUNT_JSON || ''
export const GEE_PROJECT = process.env.GEE_PROJECT || ''

// ── ที่เก็บข้อมูลแปลง ──────────────────────────────────────────────────
// ปกติเก็บเป็นไฟล์ใน server/data/ แต่บน Cloud Run ดิสก์ของคอนเทนเนอร์หายทุกครั้ง
// ที่รีสตาร์ต จึงต้องตั้ง GCS_BUCKET ให้ไปเก็บบน Google Cloud Storage แทน
// (ยืนยันตัวตนด้วย service account ที่ผูกกับ Cloud Run เอง ไม่ต้องใช้ไฟล์คีย์)
export const GCS_BUCKET = process.env.GCS_BUCKET || ''
export const GCS_FIELDS_OBJECT = process.env.GCS_FIELDS_OBJECT || 'fields.json'

// ถ้าเชื่อม GEE ไม่ได้ ให้สร้างข้อมูล NDVI จำลอง เพื่อให้ทดลอง UI ได้ทันที
export const ALLOW_DEMO = String(process.env.ALLOW_DEMO || 'true') !== 'false'

export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 60)

// ── ล็อกอินด้วยบัญชี Google ────────────────────────────────────────────
// ตั้ง GOOGLE_CLIENT_ID = OAuth 2.0 Client ID (ชนิด Web application) จาก Google Cloud
// เว้นว่าง = ปิดระบบล็อกอิน ใครเปิดหน้าเว็บก็ใช้ได้ (สะดวกตอนพัฒนาในเครื่อง)
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''

// จำกัดว่าอีเมลไหนเข้าได้บ้าง คั่นด้วยจุลภาค เว้นว่าง = ทุกบัญชี Google เข้าได้
//   ALLOWED_EMAILS=somchai@gmail.com,malee@gmail.com
export const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

// จำกัดเป็นทั้งโดเมน เช่น ALLOWED_DOMAINS=rid.go.th,ku.ac.th
export const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean)

export const AUTH_ENABLED = Boolean(GOOGLE_CLIENT_ID)

// แต่ละคนเห็นเฉพาะแปลงของตัวเอง แต่แปลงที่บันทึกไว้ก่อนเปิดใช้การล็อกอินยังไม่มีเจ้าของ
// ตั้งอีเมลไว้ตรงนี้เพื่อโอนแปลงเก่าทั้งหมดให้บัญชีนั้นครั้งเดียวตอนเริ่มระบบ
export const LEGACY_OWNER_EMAIL = (process.env.LEGACY_OWNER_EMAIL || '').trim().toLowerCase()

// ── API ภายนอก (/api/v1) ────────────────────────────────────────────────
// ให้ script / QGIS / Power BI ดึงข้อมูลแปลง + NDVI + Kc ได้โดยไม่ต้องล็อกอินและไม่ต้องใช้คีย์
// ส่งเฉพาะแปลงของอีเมลนี้เท่านั้น — แปลงของบัญชีอื่นไม่มีทางหลุดออกทาง API นี้
export const PUBLIC_API_OWNER = (process.env.PUBLIC_API_OWNER || 'gettiraput@gmail.com').trim().toLowerCase()

// จำนวนคำขอต่อนาทีต่อ IP
export const API_RATE_PER_MIN = Number(process.env.API_RATE_PER_MIN || 60)

// ช่วงวันที่ยาวที่สุดที่ขอได้ต่อครั้ง (ทั้งหน้าเว็บและ API) — ค่าเริ่มต้น 4,020 วัน = ย้อนหลังได้ถึง 1 ม.ค. ของ 10 ปีก่อน
// ช่วงยาวถูกแบ่งส่ง Earth Engine ทีละปี (services/ndvi.js) จึงไม่หมดเวลา แต่ครั้งแรกรอนานขึ้นตามจำนวนปี
export const API_MAX_RANGE_DAYS = Number(process.env.API_MAX_RANGE_DAYS || 4020)
