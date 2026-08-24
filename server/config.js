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

// ถ้าเชื่อม GEE ไม่ได้ ให้สร้างข้อมูล NDVI จำลอง เพื่อให้ทดลอง UI ได้ทันที
export const ALLOW_DEMO = String(process.env.ALLOW_DEMO || 'true') !== 'false'

export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 60)
