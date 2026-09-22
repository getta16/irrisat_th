/**
 * ยืนยันตัวตนของ API ภายนอก (/api/v1) ด้วย API key
 *
 * หน้าเว็บใช้ Google ID token ซึ่งอายุราว 1 ชั่วโมงและต้องมีคนกดล็อกอินในเบราว์เซอร์
 * ใช้กับ script / QGIS / Power BI ไม่ได้ จึงแยกมาใช้คีย์ถาวรแทน
 * แต่ละคีย์ผูกกับอีเมลเจ้าของใน API_KEYS — req.apiOwner จึงเห็นได้เฉพาะแปลงของอีเมลนั้น
 *
 * ส่งคีย์มาทาง header `X-API-Key` (หรือ `Authorization: Bearer <key>`)
 * ไม่รับทาง query string เพราะ URL ติดไปอยู่ใน log ของ proxy / ประวัติเบราว์เซอร์
 */
import { API_KEYS, API_RATE_PER_MIN } from '../config.js'

const WINDOW_MS = 60 * 1000
/** key → { windowStart, count } */
const usage = new Map()

function readKey(req) {
  const direct = req.get('x-api-key')
  if (direct) return direct.trim()
  const m = /^Bearer\s+(.+)$/i.exec((req.get('authorization') || '').trim())
  return m ? m[1].trim() : ''
}

/** แสดงใน log ได้โดยไม่เผยคีย์เต็ม */
export const keyHint = (key) => `${key.slice(0, 8)}…`

/** นับแบบหน้าต่างคงที่ 1 นาที — พอสำหรับผู้ใช้ไม่กี่ราย ถ้ารันหลาย instance ต้องย้ายไป Redis */
function overLimit(key, res) {
  const now = Date.now()
  let u = usage.get(key)
  if (!u || now - u.windowStart >= WINDOW_MS) {
    u = { windowStart: now, count: 0 }
    usage.set(key, u)
  }
  u.count++
  const remaining = Math.max(0, API_RATE_PER_MIN - u.count)
  const resetSec = Math.ceil((u.windowStart + WINDOW_MS - now) / 1000)
  res.set('X-RateLimit-Limit', String(API_RATE_PER_MIN))
  res.set('X-RateLimit-Remaining', String(remaining))
  if (u.count > API_RATE_PER_MIN) {
    res.set('Retry-After', String(resetSec))
    return true
  }
  return false
}

export function requireApiKey(req, res, next) {
  if (!API_KEYS.size) {
    return res.status(503).json({ error: 'ยังไม่ได้เปิดใช้ API ภายนอก', hint: 'ตั้ง API_KEYS ใน .env แล้วรีสตาร์ต' })
  }

  const key = readKey(req)
  const email = key && API_KEYS.get(key)
  if (!email) return res.status(401).json({ error: 'ต้องส่ง X-API-Key ที่ถูกต้องมาด้วย' })

  if (overLimit(key, res)) {
    return res.status(429).json({ error: `เรียกเกิน ${API_RATE_PER_MIN} ครั้งต่อนาที กรุณารอสักครู่` })
  }

  // id = null เพราะคีย์ไม่รู้ Google sub — store จะเทียบด้วยอีเมลแทน
  req.apiOwner = { id: null, email }
  req.apiKeyHint = keyHint(key)
  next()
}
