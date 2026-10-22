/**
 * การเข้าถึง API ภายนอก (/api/v1) แบบไม่ต้องใช้คีย์
 *
 * ทุกคำขอเห็นเฉพาะแปลงของ PUBLIC_API_OWNER — req.apiOwner จึงถูกตั้งเป็นอีเมลนั้นเสมอ
 * ไม่มีคีย์ให้นับโควตา จึงจำกัดจำนวนคำขอต่อนาทีตาม IP ของผู้เรียกแทน
 */
import { PUBLIC_API_OWNER, API_RATE_PER_MIN } from '../config.js'

const WINDOW_MS = 60 * 1000
/** ip → { windowStart, count } */
const usage = new Map()

/** นับแบบหน้าต่างคงที่ 1 นาที — พอสำหรับผู้ใช้ไม่กี่ราย ถ้ารันหลาย instance ต้องย้ายไป Redis */
function overLimit(ip, res) {
  const now = Date.now()
  let u = usage.get(ip)
  if (!u || now - u.windowStart >= WINDOW_MS) {
    u = { windowStart: now, count: 0 }
    usage.set(ip, u)
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

export function publicApiAccess(req, res, next) {
  const ip = req.ip || 'unknown'
  if (overLimit(ip, res)) {
    return res.status(429).json({ error: `เรียกเกิน ${API_RATE_PER_MIN} ครั้งต่อนาที กรุณารอสักครู่` })
  }

  // id = null เพราะไม่รู้ Google sub — store จะเทียบด้วยอีเมลแทน
  req.apiOwner = { id: null, email: PUBLIC_API_OWNER }
  req.apiKeyHint = ip
  next()
}
