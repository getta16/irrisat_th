/**
 * ค่าที่ผู้ใช้ปรับเองบนหน้าจอ (เปิด/ปิดแถบข้าง, ความทึบสีแปลง)
 * เก็บไว้ใน localStorage เพื่อให้เปิดเว็บครั้งหน้าได้หน้าตาเดิม
 *
 * บางเบราว์เซอร์ในโหมดส่วนตัวใช้ localStorage ไม่ได้เลย จึงต้องกัน error ไว้ทุกจุด
 * ผิดพลาดแค่ไหนก็แค่ได้ค่าเริ่มต้น ไม่ทำให้หน้าเว็บพัง
 */
const PREFIX = 'irrisat.pref.'

export function loadPref(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    const value = JSON.parse(raw)
    return typeof value === typeof fallback ? value : fallback
  } catch {
    return fallback
  }
}

export function savePref(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // เขียนไม่ได้ก็ใช้งานต่อได้ตามปกติ แค่ไม่ถูกจำไว้ให้ครั้งหน้า
  }
}
