/**
 * ล็อกอินด้วยบัญชี Google ฝั่งหน้าเว็บ
 *
 * ใช้ Google Identity Services (GIS) — สคริปต์ของ Google จะจัดการหน้าต่างเลือกบัญชี
 * ให้เอง แล้วส่ง ID token (JWT) กลับมาที่ callback ของเรา เราเก็บ token ไว้ใน
 * localStorage เพื่อให้รีเฟรชหน้าแล้วยังอยู่ในระบบ และแนบไปกับทุกคำขอที่ยิงไป API
 *
 * token ของ Google มีอายุราว 1 ชั่วโมง จึงตั้งเวลาขอใหม่แบบเงียบ ๆ ก่อนหมดอายุ
 * ถ้าขอใหม่ไม่สำเร็จ (เช่นผู้ใช้ออกจากบัญชี Google ไปแล้ว) ระบบจะพากลับไปหน้าล็อกอิน
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const STORAGE_KEY = 'irrisat.google.credential'

/** ขอ token ใหม่ก่อนหมดอายุจริงเท่านี้ เผื่อเวลาเครื่องผู้ใช้เดินคลาดจากของ Google */
const RENEW_BEFORE_MS = 5 * 60 * 1000

let gisPromise = null

/** โหลดสคริปต์ GIS ครั้งเดียว แล้วใช้ผลเดิมซ้ำ */
export function loadGis() {
  if (gisPromise) return gisPromise

  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google.accounts.id)

    const existing = document.querySelector(`script[src="${GIS_SRC}"]`)
    const script = existing || document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true

    script.addEventListener('load', () => {
      if (window.google?.accounts?.id) resolve(window.google.accounts.id)
      else reject(new Error('โหลดระบบล็อกอินของ Google ไม่สำเร็จ'))
    })
    script.addEventListener('error', () =>
      reject(new Error('เชื่อมต่อ accounts.google.com ไม่ได้ — ตรวจสอบอินเทอร์เน็ตหรือตัวบล็อกโฆษณา'))
    )

    if (!existing) document.head.appendChild(script)
  }).catch((err) => {
    // ให้ลองใหม่ได้ในครั้งถัดไป ไม่ค้างที่ promise ที่ล้มเหลวไปแล้ว
    gisPromise = null
    throw err
  })

  return gisPromise
}

/** อ่านเนื้อใน JWT — ไม่ใช่การตรวจสอบความถูกต้อง (ฝั่งเซิร์ฟเวอร์ตรวจลายเซ็นอีกที) */
export function decodeJwt(token) {
  try {
    const payload = token.split('.')[1]
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

/** แปลง token เป็นข้อมูลผู้ใช้ คืน null ถ้าอ่านไม่ออกหรือหมดอายุแล้ว */
export function sessionFromToken(token) {
  if (!token) return null
  const claims = decodeJwt(token)
  if (!claims?.exp) return null

  const expiresAt = claims.exp * 1000
  if (expiresAt <= Date.now()) return null

  return {
    token,
    expiresAt,
    user: {
      sub: claims.sub,
      email: claims.email || '',
      name: claims.name || claims.email || 'ผู้ใช้',
      picture: claims.picture || '',
    },
  }
}

export function loadSession() {
  try {
    const session = sessionFromToken(localStorage.getItem(STORAGE_KEY))
    if (!session) localStorage.removeItem(STORAGE_KEY)
    return session
  } catch {
    return null
  }
}

export function saveSession(token) {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // โหมดส่วนตัวของบางเบราว์เซอร์เขียน localStorage ไม่ได้ — ใช้งานต่อได้ แค่ต้องล็อกอินใหม่ทุกครั้งที่รีเฟรช
  }
}

export const clearSession = () => saveSession(null)

/** อีกกี่มิลลิวินาทีถึงควรขอ token ใหม่ (อย่างน้อย 10 วินาที กันตั้ง timer เป็น 0 วนรัว ๆ) */
export const msUntilRenew = (expiresAt) => Math.max(10_000, expiresAt - Date.now() - RENEW_BEFORE_MS)

/** บอก Google ว่าออกจากระบบแล้ว ครั้งหน้าจะได้ไม่เลือกบัญชีเดิมให้อัตโนมัติ */
export function disableAutoSelect() {
  try {
    window.google?.accounts?.id?.disableAutoSelect()
  } catch {
    // ไม่เป็นไร ถ้าสคริปต์ยังโหลดไม่เสร็จก็ไม่มีอะไรให้ยกเลิก
  }
}

/**
 * เรียก initialize ของ GIS ครั้งเดียวต่อหนึ่งหน้า — เรียกซ้ำจะทับ callback เดิม
 * ทั้งหน้าล็อกอินและตัวต่ออายุ token ใช้ตัวนี้ร่วมกัน โดยส่ง token ที่ได้ไปที่
 * handler ตัวเดียวกันที่ตั้งไว้ด้วย setCredentialHandler
 */
let gisInit = null
let credentialHandler = null

export const setCredentialHandler = (fn) => {
  credentialHandler = fn
}

export function initGis(clientId) {
  if (gisInit) return gisInit

  gisInit = loadGis()
    .then((gis) => {
      gis.initialize({
        client_id: clientId,
        callback: (res) => credentialHandler?.(res.credential),
        auto_select: true,
        cancel_on_tap_outside: false,
        context: 'signin',
        ux_mode: 'popup',
        itp_support: true,
      })
      return gis
    })
    .catch((err) => {
      gisInit = null
      throw err
    })

  return gisInit
}
