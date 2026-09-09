// ตอนรันในเครื่องใช้ proxy ของ vite ไปที่ localhost:5174 จึงเป็น path ธรรมดา
// ส่วนตอน deploy เป็นหน้าเว็บนิ่ง (เช่น GitHub Pages) ที่ไม่มี API อยู่โดเมนเดียวกัน
// ให้ตั้ง VITE_API_BASE ตอน build ชี้ไปยังเซิร์ฟเวอร์ที่โฮสต์ไว้ที่อื่น
const BASE = import.meta.env.VITE_API_BASE || '/api'

// token ของ Google ที่หน้าเว็บถืออยู่ — ตั้งจาก App หลังล็อกอินสำเร็จ
let authToken = null
let onUnauthorized = null

export const setAuthToken = (token) => {
  authToken = token || null
}

/** ให้ App รู้เมื่อ token หมดอายุกลางคัน จะได้พากลับไปหน้าล็อกอิน */
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) }
  if (authToken) headers.authorization = `Bearer ${authToken}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  const isJson = res.headers.get('content-type')?.includes('application/json')
  const body = isJson ? await res.json().catch(() => null) : null

  if (!res.ok) {
    // 401 = ยังไม่ได้ล็อกอินหรือ token หมดอายุ (403 คือล็อกอินแล้วแต่ไม่มีสิทธิ์ — ไม่ต้องเตะออก)
    if (res.status === 401) onUnauthorized?.(body?.error)

    const err = new Error(body?.error || `คำขอล้มเหลว (${res.status})`)
    err.hint = body?.hint
    err.detail = body?.detail
    err.status = res.status
    throw err
  }
  return body
}

const json = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  status: () => request('/status'),
  options: () => request('/analysis/options'),

  /** หน้าเว็บต้องรู้ก่อนว่าเซิร์ฟเวอร์บังคับล็อกอินไหม และใช้ client id ตัวไหน */
  authConfig: () => request('/auth/config'),
  verifyLogin: (credential) => request('/auth/verify', json('POST', { credential })),

  /** อัปโหลดไฟล์ขอบเขตพื้นที่ — ยังไม่บันทึก แค่แปลงเป็น GeoJSON ให้ตรวจก่อน */
  importFiles(fileList, { epsg } = {}) {
    const form = new FormData()
    for (const f of fileList) form.append('files', f)
    if (epsg) form.append('epsg', String(epsg))
    return request('/import', { method: 'POST', body: form })
  },

  listFields: () => request('/fields'),

  /** บันทึกแปลงที่นำเข้ามา — replace = ลบแปลงเดิมทั้งหมดก่อน */
  createFields: (fields, { replace = false } = {}) => request('/fields', json('POST', { fields, replace })),
  createFromGeoJSON: (geojson) => request('/fields', json('POST', { geojson })),
  updateField: (id, patch) => request(`/fields/${id}`, json('PATCH', patch)),

  deleteField: (id) => request(`/fields/${id}`, { method: 'DELETE' }),
  deleteFields: (ids) => request('/fields', json('DELETE', { ids })),
  deleteAllFields: () => request('/fields?all=1', { method: 'DELETE' }),

  analyse: (payload) => request('/analysis', json('POST', payload)),
  tiles: (payload) => request('/analysis/tiles', json('POST', payload)),
}
