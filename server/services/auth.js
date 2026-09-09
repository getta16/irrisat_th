/**
 * ยืนยันตัวตนด้วยบัญชี Google (Google Identity Services)
 *
 * หน้าเว็บให้ผู้ใช้กดปุ่ม "ลงชื่อเข้าใช้ด้วย Google" แล้วได้ ID token (JWT) กลับมา
 * จากนั้นแนบมากับทุกคำขอเป็น `Authorization: Bearer <token>`
 * ฝั่งนี้ตรวจลายเซ็นของ token กับกุญแจสาธารณะของ Google (ไลบรารีแคชให้เอง)
 * แล้วเช็คว่า audience ตรงกับ GOOGLE_CLIENT_ID ของเรา — กัน token จากเว็บอื่นมาใช้
 *
 * ถ้าไม่ได้ตั้ง GOOGLE_CLIENT_ID ระบบจะไม่บังคับล็อกอิน (ใช้ตอนพัฒนาในเครื่อง)
 */
import { OAuth2Client } from 'google-auth-library'
import { GOOGLE_CLIENT_ID, ALLOWED_EMAILS, ALLOWED_DOMAINS, AUTH_ENABLED } from '../config.js'

const client = AUTH_ENABLED ? new OAuth2Client(GOOGLE_CLIENT_ID) : null

/**
 * ตรวจ token ซ้ำ ๆ ทุกคำขอเปลืองเวลา จึงจำผลไว้จนกว่า token จะหมดอายุ
 * (ตัว token เองมีอายุราว 1 ชั่วโมง หน้าเว็บจะขอใหม่ก่อนหมดอายุให้เอง)
 */
const verified = new Map()

function sweep() {
  const now = Date.now()
  for (const [token, entry] of verified) if (entry.expiresAt <= now) verified.delete(token)
}

/** อีเมลนี้มีสิทธิ์เข้าระบบไหม — ไม่ตั้งอะไรไว้เลย = ทุกบัญชี Google เข้าได้ */
export function isAllowed(email) {
  if (!email) return false
  const addr = email.toLowerCase()
  if (!ALLOWED_EMAILS.length && !ALLOWED_DOMAINS.length) return true
  if (ALLOWED_EMAILS.includes(addr)) return true
  return ALLOWED_DOMAINS.includes(addr.split('@')[1] || '')
}

/** @returns {Promise<{sub,email,name,picture,expiresAt}>} โยน error ถ้า token ใช้ไม่ได้ */
export async function verifyIdToken(token) {
  sweep()
  const cached = verified.get(token)
  if (cached) return cached.user

  const ticket = await client.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID })
  const payload = ticket.getPayload()

  if (!payload?.email) throw new Error('token นี้ไม่มีอีเมล')
  if (!payload.email_verified) throw new Error('อีเมลนี้ยังไม่ได้ยืนยันกับ Google')

  const user = {
    sub: payload.sub,
    email: payload.email,
    name: payload.name || payload.email,
    picture: payload.picture || '',
    expiresAt: payload.exp * 1000,
  }

  verified.set(token, { user, expiresAt: user.expiresAt })
  return user
}

const bearer = (req) => {
  const header = req.get('authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m ? m[1].trim() : ''
}

/**
 * ปิดกั้นเส้นทางที่ต้องล็อกอินก่อน
 * ตอบ 401 = ยังไม่ได้ล็อกอิน / token หมดอายุ (หน้าเว็บจะพากลับไปหน้าล็อกอิน)
 * ตอบ 403 = ล็อกอินได้แต่อีเมลไม่อยู่ในรายชื่อที่อนุญาต
 */
export async function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) return next()

  const token = bearer(req)
  if (!token) return res.status(401).json({ error: 'ต้องลงชื่อเข้าใช้ด้วยบัญชี Google ก่อน' })

  try {
    const user = await verifyIdToken(token)
    if (!isAllowed(user.email)) {
      return res.status(403).json({
        error: `บัญชี ${user.email} ยังไม่ได้รับสิทธิ์ใช้งานระบบนี้`,
        hint: 'ติดต่อผู้ดูแลเพื่อเพิ่มอีเมลของคุณใน ALLOWED_EMAILS',
      })
    }
    req.user = user
    next()
  } catch (err) {
    res.status(401).json({
      error: 'การลงชื่อเข้าใช้หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่',
      detail: String(err?.message || err),
    })
  }
}

/**
 * เจ้าของข้อมูลของคำขอนี้ — ใช้ส่งต่อให้ store เพื่อกรองแปลงตามผู้ใช้
 * คืน null เมื่อไม่ได้บังคับล็อกอิน ซึ่ง store จะถือเป็นโหมดผู้ใช้คนเดียว (เห็นทุกแปลง)
 */
export const ownerOf = (req) => (req.user ? { id: req.user.sub, email: req.user.email } : null)

/** ข้อมูลที่หน้าเว็บต้องรู้ก่อนจะแสดงปุ่มล็อกอินได้ */
export const authConfig = () => ({ enabled: AUTH_ENABLED, clientId: GOOGLE_CLIENT_ID })
