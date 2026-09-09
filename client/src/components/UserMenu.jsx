import { useEffect, useRef, useState } from 'react'

/** ชื่อ/รูปบัญชีที่ล็อกอินอยู่ กดแล้วมีเมนูออกจากระบบ */
export default function UserMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)

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

  const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase()

  return (
    <div className="user-menu" ref={box}>
      <button
        className="user-chip"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user.email}
      >
        {user.picture ? (
          <img src={user.picture} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="avatar-letter">{initial}</span>
        )}
        <span className="user-name">{user.name}</span>
        <span className="caret">▾</span>
      </button>

      {open && (
        <div className="user-dropdown" role="menu">
          <div className="user-dropdown-head">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
          <button className="btn ghost block" role="menuitem" onClick={onSignOut}>
            ออกจากระบบ
          </button>
        </div>
      )}
    </div>
  )
}
