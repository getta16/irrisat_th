/**
 * ทดสอบเส้นทางหลักของระบบตั้งแต่ต้นจนจบ: นำเข้าไฟล์ → บันทึกแปลง → ประมวลผล
 * รันด้วย:  npm run test:smoke   (ต้องเปิดเซิร์ฟเวอร์ไว้ก่อน)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SAMPLES = path.join(__dirname, '..', '..', 'samples')
const BASE = process.env.BASE_URL || 'http://localhost:5174'

let passed = 0
let failed = 0

function check(name, ok, extra = '') {
  if (ok) {
    passed++
    console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

async function post(url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

async function importFile(filenames) {
  const form = new FormData()
  for (const name of filenames) {
    const full = path.join(SAMPLES, name)
    form.append('files', new Blob([fs.readFileSync(full)]), path.basename(name))
  }
  const res = await fetch(`${BASE}/api/import`, { method: 'POST', body: form })
  return { status: res.status, body: await res.json().catch(() => null) }
}

async function main() {
  console.log(`\nทดสอบระบบที่ ${BASE}\n`)

  console.log('1. สถานะเซิร์ฟเวอร์')
  const status = await fetch(`${BASE}/api/status`).then((r) => r.json())
  check('API ตอบกลับ', status.ok === true, `โหมด NDVI: ${status.gee.mode}`)

  console.log('\n2. นำเข้าไฟล์')

  const kml = await importFile(['sample-fields.kml'])
  check('KML', kml.status === 200 && kml.body.count === 3, `${kml.body?.count ?? kml.body?.error} พื้นที่`)

  const gj = await importFile(['sample-fields.geojson'])
  check('GeoJSON', gj.status === 200 && gj.body.count === 3, `${gj.body?.count ?? gj.body?.error} พื้นที่`)

  const zip = await importFile(['sample-fields-shapefile.zip'])
  check('Shapefile (.zip)', zip.status === 200 && zip.body.count === 3, `${zip.body?.count ?? zip.body?.error} พื้นที่`)

  const loose = await importFile(
    ['shp', 'shx', 'dbf', 'prj', 'cpg'].map((e) => path.join('shapefile-แยกไฟล์', `sample-fields.${e}`))
  )
  check(
    'Shapefile (เลือกไฟล์แยก)',
    loose.status === 200 && loose.body.count === 3,
    `${loose.body?.count ?? loose.body?.error} พื้นที่`
  )

  const namesOk = zip.body?.fields?.every((f) => f.name && f.name !== 'แปลงไม่มีชื่อ')
  check('อ่านชื่อแปลงจากตาราง attribute ได้', !!namesOk, zip.body?.fields?.map((f) => f.name).join(', '))

  const areaOk = zip.body?.fields?.every((f) => f.areaRai > 0.5 && f.areaRai < 2000)
  check('คำนวณพื้นที่เป็นไร่ได้สมเหตุสมผล', !!areaOk, zip.body?.fields?.map((f) => f.areaRai.toFixed(1)).join(', '))

  const bad = await post('/api/import', {})
  check('ปฏิเสธคำขอที่ไม่มีไฟล์', bad.status >= 400)

  console.log('\n3. บันทึกแปลงและประมวลผล')

  const created = await post('/api/fields', { fields: zip.body.fields.slice(0, 1) })
  check('บันทึกแปลงได้', created.status === 201 && created.body.fields?.length === 1)

  const field = created.body.fields[0]

  const analysis = await post('/api/analysis', { fieldId: field.id })
  const a = analysis.body
  check('ประมวลผลสำเร็จ', analysis.status === 200, a?.error || '')

  if (analysis.status === 200) {
    check('ได้ข้อมูลอากาศรายวัน', a.days.length > 100, `${a.days.length} วัน`)
    check('มีค่า NDVI จากดาวเทียม', a.ndvi.observations.length > 0, `${a.ndvi.observations.length} ภาพ (${a.ndvi.source})`)

    const et0s = a.days.map((d) => d.et0).filter(Number.isFinite)
    const avgEt0 = et0s.reduce((s, v) => s + v, 0) / et0s.length
    check('ET₀ อยู่ในช่วงที่เป็นไปได้ของเขตร้อน (2–8 มม./วัน)', avgEt0 > 2 && avgEt0 < 8, `เฉลี่ย ${avgEt0.toFixed(2)} มม./วัน`)

    const kcs = a.days.map((d) => d.kc).filter(Number.isFinite)
    check('Kc อยู่ในช่วง 0–1.25', kcs.every((k) => k >= 0 && k <= 1.25), `สูงสุด ${Math.max(...kcs).toFixed(2)}`)

    const deficits = a.days.map((d) => d.deficit)
    check(
      'น้ำที่พร่องไม่เกินความจุของดิน',
      deficits.every((d) => d >= 0 && d <= a.settings.taw + 0.01),
      `TAW ${a.settings.taw} มม. · พร่องสูงสุด ${Math.max(...deficits).toFixed(0)} มม.`
    )

    check('สรุปคำแนะนำการให้น้ำได้', Number.isFinite(a.summary.recommendedIrrigationMm),
      `แนะนำ ${a.summary.recommendedIrrigationMm} มม. · อีก ${a.summary.daysUntilIrrigation} วัน`)
  }

  console.log('\n4. แก้ไขและลบ')
  const patched = await fetch(`${BASE}/api/fields/${field.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'แปลงทดสอบ', settings: { crop: 'rice', soil: 'clay' } }),
  }).then((r) => r.json())
  check('แก้ไขการตั้งค่าแปลงได้', patched.field?.name === 'แปลงทดสอบ' && patched.field?.settings.crop === 'rice')

  const del = await fetch(`${BASE}/api/fields/${field.id}`, { method: 'DELETE' })
  check('ลบแปลงได้', del.status === 204)

  console.log(`\nผลรวม: ผ่าน ${passed} · ไม่ผ่าน ${failed}\n`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('\nการทดสอบล้มเหลว:', e)
  process.exit(1)
})
