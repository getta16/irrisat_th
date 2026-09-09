import { useCallback, useEffect, useRef, useState } from 'react'
import { api, setAuthToken, setUnauthorizedHandler } from './api.js'
import {
  clearSession,
  disableAutoSelect,
  initGis,
  loadSession,
  msUntilRenew,
  saveSession,
  sessionFromToken,
  setCredentialHandler,
} from './auth.js'

/**
 * สถานะการล็อกอินของทั้งหน้าเว็บ
 *
 * phase:
 *   'loading'    — กำลังถามเซิร์ฟเวอร์ว่าต้องล็อกอินไหม / กำลังตรวจ token เดิม
 *   'signed-out' — ต้องล็อกอินก่อน แสดงหน้าล็อกอิน
 *   'ready'      — เข้าใช้งานได้ (ล็อกอินแล้ว หรือเซิร์ฟเวอร์ไม่ได้บังคับล็อกอิน)
 */
export function useAuth() {
  const [phase, setPhase] = useState('loading')
  const [clientId, setClientId] = useState('')
  const [user, setUser] = useState(null)
  const [error, setError] = useState(null)
  const [checking, setChecking] = useState(false)

  // ใช้ใน callback ที่ไม่ได้ผูกกับรอบ render — อ่านค่าล่าสุดเสมอ
  const tokenRef = useRef(null)
  const clientIdRef = useRef('')
  const timers = useRef([])

  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  const signOut = useCallback((message = null) => {
    clearTimers()
    tokenRef.current = null
    setAuthToken(null)
    clearSession()
    disableAutoSelect()
    setUser(null)
    setError(message)
    setPhase('signed-out')
  }, [])

  /** ยึด token ที่เพิ่งได้มาเป็นของจริง แล้วตั้งเวลาต่ออายุก่อนหมดอายุ */
  const adoptToken = useCallback(
    (token) => {
      const session = sessionFromToken(token)
      if (!session) return signOut('อ่านข้อมูลการเข้าสู่ระบบไม่ได้ กรุณาลองใหม่')

      clearTimers()
      tokenRef.current = token
      setAuthToken(token)
      saveSession(token)
      setUser(session.user)
      setError(null)
      setPhase('ready')

      // token ของ Google มีอายุราวชั่วโมงเดียว — ขอใหม่เงียบ ๆ ก่อนหมด
      timers.current.push(
        setTimeout(() => {
          if (!clientIdRef.current) return
          initGis(clientIdRef.current)
            .then((gis) => gis.prompt())
            .catch(() => {})
        }, msUntilRenew(session.expiresAt))
      )

      // ถ้าต่ออายุไม่สำเร็จจนหมดอายุจริง ให้กลับไปหน้าล็อกอินแทนที่จะปล่อยให้คำขอพัง
      timers.current.push(
        setTimeout(() => {
          if (tokenRef.current === token) signOut('หมดเวลาการใช้งาน กรุณาลงชื่อเข้าใช้อีกครั้ง')
        }, Math.max(1000, session.expiresAt - Date.now()))
      )
    },
    [signOut]
  )

  /** ส่ง token ให้เซิร์ฟเวอร์ตรวจก่อน — จะได้รู้ตั้งแต่ต้นว่าอีเมลนี้มีสิทธิ์ไหม */
  const submitCredential = useCallback(
    async (token) => {
      if (!token) return
      setChecking(true)
      setAuthToken(token)
      try {
        await api.verifyLogin(token)
        adoptToken(token)
      } catch (err) {
        setAuthToken(tokenRef.current)
        const rejected = err.status === 401 || err.status === 403
        // ยังมี session เดิมที่ใช้ได้อยู่ และพลาดเพราะเหตุอื่น (เช่นเน็ตหลุด) — ใช้ของเดิมต่อไป
        if (!rejected && sessionFromToken(tokenRef.current)) return
        // 403 = ล็อกอิน Google ผ่านแล้วแต่อีเมลไม่อยู่ในรายชื่อที่อนุญาต
        signOut([err.message, err.hint].filter(Boolean).join(' — '))
      } finally {
        setChecking(false)
      }
    },
    [adoptToken, signOut]
  )

  useEffect(() => {
    setCredentialHandler(submitCredential)
  }, [submitCredential])

  // ถามเซิร์ฟเวอร์ครั้งแรกว่าบังคับล็อกอินไหม แล้วกู้ session เดิมถ้ายังไม่หมดอายุ
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      let config
      try {
        config = await api.authConfig()
      } catch {
        // ติดต่อ API ไม่ได้ (เช่นยังไม่ได้สตาร์ตเซิร์ฟเวอร์) — ปล่อยให้เข้าหน้าหลักไปก่อน
        // ถ้าเซิร์ฟเวอร์บังคับล็อกอินจริง คำขอถัดไปจะได้ 401 แล้วค่อยเด้งไปหน้าล็อกอิน
        if (!cancelled) setPhase('ready')
        return
      }
      if (cancelled) return

      clientIdRef.current = config.clientId || ''
      setClientId(clientIdRef.current)
      if (!config.enabled) return setPhase('ready')

      const session = loadSession()
      if (!session) return setPhase('signed-out')

      setAuthToken(session.token)
      try {
        await api.verifyLogin(session.token)
        if (!cancelled) adoptToken(session.token)
      } catch (err) {
        if (!cancelled) signOut(err.status === 403 ? err.message : null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  // token หมดอายุระหว่างใช้งาน หรือเซิร์ฟเวอร์เพิ่งเปิดการบังคับล็อกอิน
  useEffect(() => {
    setUnauthorizedHandler((message) => {
      if (phase === 'signed-out') return
      api
        .authConfig()
        .then((config) => {
          clientIdRef.current = config.clientId || ''
          setClientId(clientIdRef.current)
        })
        .catch(() => {})
      signOut(message || 'กรุณาลงชื่อเข้าใช้อีกครั้ง')
    })
    return () => setUnauthorizedHandler(null)
  }, [phase, signOut])

  useEffect(() => clearTimers, [])

  return { phase, clientId, user, error, checking, signOut, submitCredential }
}
