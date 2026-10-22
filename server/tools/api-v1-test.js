/**
 * ทดสอบ API ภายนอก /api/v1 กับเซิร์ฟเวอร์ที่เปิดอยู่
 * รันด้วย:  npm run test:api   (ต้องเปิดเซิร์ฟเวอร์ไว้ก่อน)
 *
 * ไม่ต้องใช้คีย์ — กำหนดเซิร์ฟเวอร์เองได้ด้วย BASE_URL=...
 * ถ้า Earth Engine พร้อม จะดึง NDVI จริงของแปลงที่เล็กที่สุด (ใช้เวลาไม่กี่วินาที)
 */
import { PUBLIC_API_OWNER } from '../config.js'

const BASE = process.env.BASE_URL || 'http://localhost:5174'

let passed = 0
let failed = 0

function check(name, ok, extra = '') {
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`)
}

async function get(path, headers = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, { headers })
  const text = await res.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: res.status, headers: res.headers, body }
}

async function main() {
  console.log(`\nทดสอบ API v1 ที่ ${BASE}\n`)
  console.log('1. รายการแปลง (ไม่ส่งคีย์)')
  const list = await get('/areas')
  check('GET /areas', list.status === 200 && Array.isArray(list.body.areas), `${list.body.count} แปลงของ ${list.body.owner}`)
  check(`เห็นเฉพาะแปลงของ ${PUBLIC_API_OWNER}`, list.body.owner === PUBLIC_API_OWNER)
  check('ส่งคีย์มั่ว ๆ มาก็ไม่เปลี่ยนผล', (await get('/areas', { 'x-api-key': 'x'.repeat(32) })).body.count === list.body.count)
  check('ไม่แนบรูปทรงถ้าไม่ขอ', list.body.areas.every((a) => !a.geometry))
  check('ไม่มี CORS บน v1', !list.headers.get('access-control-allow-origin'))

  const gj = await get('/areas.geojson')
  check(
    'GET /areas.geojson',
    gj.status === 200 && gj.body.type === 'FeatureCollection' && gj.body.features.length === list.body.count,
    `${gj.body.features?.length} features`
  )

  if (!list.body.count) {
    console.log('\n  (บัญชีนี้ยังไม่มีแปลง — ข้ามการทดสอบ NDVI)')
    return
  }

  const smallest = [...list.body.areas].sort((a, b) => a.areaM2 - b.areaM2)[0]
  const one = await get(`/areas/${smallest.id}`)
  check('GET /areas/:id มีรูปทรง', one.status === 200 && !!one.body.area.geometry, smallest.name)
  check('แปลงที่ไม่มีอยู่ → 404', (await get('/areas/00000000-0000-0000-0000-000000000000')).status === 404)

  console.log('\n2. ตรวจค่าที่ส่งมา')
  check('ช่วงวันยาวเกิน → 400', (await get(`/areas/${smallest.id}/ndvi?start=2010-01-01&end=2026-01-01`)).status === 400)
  check('fromYear ผิด → 400', (await get(`/areas/${smallest.id}/ndvi?fromYear=18`)).status === 400)
  check('วันที่ผิดรูปแบบ → 400', (await get(`/areas/${smallest.id}/ndvi?start=01/06/2026`)).status === 400)
  check('collection ผิด → 400', (await get(`/areas/${smallest.id}/ndvi?collection=MODIS`)).status === 400)

  console.log('\n3. NDVI + Kc จาก Earth Engine')
  const status = await fetch(`${BASE}/api/status`).then((r) => r.json())
  if (!status.gee.ready) {
    const r = await get(`/areas/${smallest.id}/ndvi`)
    check('Earth Engine ไม่พร้อม → 503 (ไม่ส่งข้อมูลจำลอง)', r.status === 503, r.body.detail)
    return
  }

  const t0 = Date.now()
  const ndvi = await get(`/areas/${smallest.id}/ndvi`)
  const obs = ndvi.body.observations || []
  check('GET /areas/:id/ndvi', ndvi.status === 200 && ndvi.body.meta?.source === 'earth-engine', `${obs.length} ภาพ · ${Date.now() - t0} ms`)
  check(
    'Kc = 1.37 × NDVI − 0.086 ทุกแถว',
    obs.every((o) => Math.abs(o.kc - Math.min(1.25, Math.max(0, 1.37 * o.ndvi - 0.086))) < 0.002)
  )

  const ts = await get(`/areas/${smallest.id}/timeseries`)
  const days = ts.body.days || []
  check('GET /areas/:id/timeseries', ts.status === 200 && days.length > 0, `${days.length} วัน`)
  check('จำนวนวันที่ observed ตรงกับจำนวนภาพ', days.filter((d) => d.observed).length === obs.length)

  const csv = await get(`/areas/${smallest.id}/ndvi?format=csv`)
  check(
    'format=csv',
    csv.status === 200 && typeof csv.body === 'string' && csv.body.includes('area_id,area_name,date,ndvi,kc'),
    `${csv.body.split('\n').filter(Boolean).length - 1} แถว`
  )
}

main()
  .catch((err) => {
    failed++
    console.error('\n  ✗ ทดสอบล้ม:', err.message)
  })
  .finally(() => {
    console.log(`\nผ่าน ${passed} · ไม่ผ่าน ${failed}\n`)
    process.exit(failed ? 1 : 0)
  })
