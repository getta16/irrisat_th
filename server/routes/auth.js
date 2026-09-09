import { Router } from 'express'
import { authConfig, verifyIdToken, isAllowed } from '../services/auth.js'
import { AUTH_ENABLED } from '../config.js'

const router = Router()

/** เปิดให้เรียกได้โดยไม่ต้องล็อกอิน — หน้าเว็บต้องใช้ clientId มาสร้างปุ่ม Google */
router.get('/config', (_req, res) => {
  res.json(authConfig())
})

/** ตรวจว่า token ที่หน้าเว็บถืออยู่ยังใช้ได้ และเจ้าของมีสิทธิ์เข้าระบบไหม */
router.post('/verify', async (req, res) => {
  if (!AUTH_ENABLED) {
    return res.json({ enabled: false, user: null })
  }

  const token = String(req.body?.credential || '')
  if (!token) return res.status(400).json({ error: 'ไม่ได้ส่ง credential มาด้วย' })

  try {
    const user = await verifyIdToken(token)
    if (!isAllowed(user.email)) {
      return res.status(403).json({
        error: `บัญชี ${user.email} ยังไม่ได้รับสิทธิ์ใช้งานระบบนี้`,
        hint: 'ติดต่อผู้ดูแลเพื่อเพิ่มอีเมลของคุณใน ALLOWED_EMAILS',
      })
    }
    res.json({ enabled: true, user })
  } catch (err) {
    res.status(401).json({
      error: 'ตรวจสอบการลงชื่อเข้าใช้ไม่ผ่าน กรุณาเข้าสู่ระบบใหม่',
      detail: String(err?.message || err),
    })
  }
})

export default router
