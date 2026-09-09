import { useEffect, useRef, useState } from 'react'
import { disableAutoSelect, initGis } from '../auth.js'

/**
 * ปุ่มลงชื่อเข้าใช้ที่มุมขวาบนของแถบหัวเรื่อง — ใช้แทนหน้าล็อกอินเต็มจอ
 * ตัวปุ่มวาดโดยสคริปต์ของ Google เอง (ข้อกำหนดของ Google ไม่ให้ทำปุ่มเลียนแบบขึ้นมาเอง)
 * ส่วนปุ่ม ▾ ข้าง ๆ ไว้เลือกบัญชีอื่นและดูเหตุผลตอนเข้าไม่ได้
 *
 * token ที่ได้จะวิ่งเข้า handler ที่ useAuth ตั้งไว้ ไม่ได้ผ่านคอมโพเนนต์นี้
 * เพราะต้องใช้ handler ตัวเดียวกันตอนต่ออายุ token ทีหลังด้วย
 */

// One Tap ควรเด้งครั้งเดียวตอนเปิดหน้าเว็บ ถ้าเด้งทุกครั้งที่คอมโพเนนต์นี้ถูกวาดใหม่
// คนที่เพิ่งกด "ออกจากระบบ" จะโดนหน้าต่างเลือกบัญชีทับหน้าจอทันที
let promptedOnce = false

export default function SignInButton({ clientId, error, busy }) {
  const buttonBox = useRef(null)
  const box = useRef(null)
  const [open, setOpen] = useState(false)
  const [gisError, setGisError] = useState(null)
  const [hint, setHint] = useState(null)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false

    initGis(clientId)
      .then((gis) => {
        if (cancelled || !buttonBox.current) return

        // React ใน StrictMode เรียก effect สองรอบ — ล้างของเดิมก่อนกันปุ่มซ้อนกันสองอัน
        buttonBox.current.replaceChildren()
        gis.renderButton(buttonBox.current, {
          type: 'standard',
          theme: 'filled_blue',
          size: 'medium',
          shape: 'pill',
          text: 'signin_with',
          logo_alignment: 'left',
          locale: 'th',
        })

        // ถ้ายังลงชื่อเข้าใช้ Google อยู่และเคยอนุญาตแล้ว จะเข้าให้เลยโดยไม่ต้องกด
        if (!promptedOnce) {
          promptedOnce = true
          gis.prompt()
        }
      })
      .catch((err) => {
        if (!cancelled) setGisError(err.message)
      })

    return () => {
      cancelled = true
    }
  }, [clientId])

  // เข้าไม่ได้ (เช่นอีเมลไม่อยู่ในรายชื่อที่อนุญาต) ต้องเห็นเหตุผลทันที ไม่ต้องรอกดเปิดเอง
  useEffect(() => {
    if (error) setOpen(true)
  }, [error])

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (!box.current?.contains(e.target)) setOpen(false)
    }
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  /** เลิกเลือกบัญชีเดิมให้อัตโนมัติ แล้วเปิดหน้าต่างของ Google ให้พิมพ์อีเมลเอง */
  const useAnotherAccount = () => {
    setHint(null)
    setOpen(false)
    initGis(clientId)
      .then((gis) => {
        disableAutoSelect()
        gis.prompt((notice) => {
          // เบราว์เซอร์บางตัวบล็อก One Tap ไว้ — บอกทางที่ยังใช้ได้แทนที่จะเงียบไปเฉย ๆ
          if (notice?.isNotDisplayed?.() || notice?.isSkippedMoment?.()) {
            setHint('กดปุ่ม "ลงชื่อเข้าใช้ด้วย Google" แล้วเลือก "ใช้บัญชีอื่น" ในหน้าต่างของ Google')
            setOpen(true)
          }
        })
      })
      .catch((err) => {
        setGisError(err.message)
        setOpen(true)
      })
  }

  if (!clientId) return null

  return (
    <div className="signin-menu" ref={box}>
      {busy ? (
        <span className="signin-busy">
          <span className="spinner" /> กำลังตรวจสอบสิทธิ์…
        </span>
      ) : (
        <div className="signin-button" ref={buttonBox} />
      )}

      <button
        className={`signin-more${error ? ' has-error' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="ตัวเลือกการลงชื่อเข้าใช้"
        title="ตัวเลือกการลงชื่อเข้าใช้"
      >
        <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="signin-dropdown" role="menu">
          {error && <div className="note error">{error}</div>}
          {gisError && (
            <div className="note error">
              {gisError}
              <span style={{ display: 'block' }}>ลองปิดตัวบล็อกโฆษณา หรือโหลดหน้านี้ใหม่อีกครั้ง</span>
            </div>
          )}
          {hint && <div className="note warn">{hint}</div>}

          <button className="btn ghost block" role="menuitem" onClick={useAnotherAccount}>
            ใช้บัญชี Google อื่น…
          </button>

          <div className="signin-foot">
            ระบบขอเพียงชื่อและอีเมลของบัญชีเพื่อยืนยันตัวตนเท่านั้น ไม่มีการเข้าถึงอีเมลหรือไฟล์ของคุณ
          </div>
        </div>
      )}
    </div>
  )
}
