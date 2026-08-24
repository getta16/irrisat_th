/**
 * เก็บข้อมูลแปลงเป็น JSON ก้อนเดียว — พอสำหรับการใช้งานคนเดียว
 * ถ้าจะขยายเป็นหลายผู้ใช้ในอนาคต ให้เปลี่ยนเฉพาะไฟล์นี้เป็น SQLite/Postgres
 *
 * เก็บได้สองที่:
 *   - ไฟล์ในเครื่อง (ค่าเริ่มต้น) — ใช้ตอนพัฒนา
 *   - Google Cloud Storage (เมื่อตั้ง GCS_BUCKET) — จำเป็นตอนรันบน Cloud Run
 *     เพราะดิสก์ของคอนเทนเนอร์หายทุกครั้งที่รีสตาร์ตหรือ deploy ใหม่
 *
 * อ่านจากสำเนาในหน่วยความจำเสมอ (เร็ว และทำให้ฟังก์ชันอ่านยังเป็น sync เหมือนเดิม)
 * ส่วนการเขียนจะบันทึกลงที่เก็บจริงให้สำเร็จก่อน แล้วค่อยอัปเดตสำเนาในหน่วยความจำ
 * ถ้าบันทึกพลาด สำเนาในหน่วยความจำจะยังตรงกับที่เก็บจริงอยู่
 */
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { FIELDS_FILE, GCS_BUCKET, GCS_FIELDS_OBJECT } from '../config.js'

let cache = []
let loaded = false
/** โหลดตอนเริ่มระบบไม่สำเร็จ — ห้ามเขียนทับ ไม่อย่างนั้นข้อมูลเดิมจะหายทั้งก้อน */
let loadFailed = false
let remote = null

async function gcsFile() {
  if (remote) return remote
  const { Storage } = await import('@google-cloud/storage')
  remote = new Storage().bucket(GCS_BUCKET).file(GCS_FIELDS_OBJECT)
  return remote
}

function readLocal() {
  if (!fs.existsSync(FIELDS_FILE)) return []
  const raw = fs.readFileSync(FIELDS_FILE, 'utf8').trim()
  return raw ? JSON.parse(raw) : []
}

/** ต้องเรียกครั้งเดียวตอนเริ่มระบบ ก่อนรับคำขอแรก */
export async function initStore() {
  if (loaded) return { count: cache.length, where: GCS_BUCKET ? 'gcs' : 'file' }

  try {
    if (GCS_BUCKET) {
      const file = await gcsFile()
      const [exists] = await file.exists()
      if (exists) {
        const [buf] = await file.download()
        cache = JSON.parse(buf.toString('utf8').trim() || '[]')
      } else {
        cache = []
      }
    } else {
      cache = readLocal()
    }
  } catch (e) {
    // ปล่อยให้ระบบขึ้นต่อได้เพื่อให้ /api/status ยังตอบและวินิจฉัยได้
    // แต่ล็อกการเขียนไว้ กันเขียนทับข้อมูลเดิมด้วยก้อนว่าง
    loadFailed = true
    cache = []
    console.error('อ่านข้อมูลแปลงไม่สำเร็จ — ปิดการบันทึกไว้ก่อน:', e.message)
  }

  loaded = true
  return { count: cache.length, where: GCS_BUCKET ? 'gcs' : 'file', failed: loadFailed }
}

let queue = Promise.resolve()

/** บันทึกลงที่เก็บจริงแบบเข้าคิวกันเขียนชนกัน สำเร็จแล้วจึงอัปเดตสำเนาในหน่วยความจำ */
function writeAll(fields) {
  const save = async () => {
    if (loadFailed) {
      throw new Error('อ่านข้อมูลแปลงเดิมไม่สำเร็จตอนเริ่มระบบ จึงไม่บันทึกทับ — ตรวจสิทธิ์ที่เก็บข้อมูลแล้วรีสตาร์ต')
    }

    const json = JSON.stringify(fields, null, 2)

    if (GCS_BUCKET) {
      const file = await gcsFile()
      await file.save(json, { contentType: 'application/json; charset=utf-8', resumable: false })
    } else {
      // เขียนแบบ atomic (เขียนไฟล์ชั่วคราวแล้ว rename)
      const tmp = `${FIELDS_FILE}.tmp`
      fs.writeFileSync(tmp, json, 'utf8')
      fs.renameSync(tmp, FIELDS_FILE)
    }

    cache = fields
    return fields
  }

  // ต่อคิวไม่ว่างานก่อนหน้าจะสำเร็จหรือล้มเหลว และไม่ปล่อยให้ error ค้างอยู่ในคิว
  const run = queue.then(save, save)
  queue = run.then(
    () => {},
    () => {}
  )
  return run
}

const readAll = () => cache

export const listFields = () => readAll()

export const getField = (id) => readAll().find((f) => f.id === id) || null

/**
 * @param {Array} items แปลงที่ผ่าน normalizeToFields มาแล้ว
 * @param {object} [opts]
 * @param {boolean} [opts.replace=false] ลบแปลงเดิมทั้งหมดทิ้งก่อนบันทึกชุดใหม่
 */
export async function createFields(items, opts = {}) {
  const all = opts.replace ? [] : readAll()
  const now = new Date().toISOString()
  const created = items.map((item) => ({
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    name: item.name || 'แปลงไม่มีชื่อ',
    geometry: item.geometry,
    areaM2: item.areaM2,
    areaRai: item.areaRai,
    areaHa: item.areaHa,
    centroid: item.centroid,
    bbox: item.bbox,
    properties: item.properties || {},
    settings: {
      crop: 'other',
      soil: 'loam',
      rootDepth: null,
      p: null,
      irrigationEfficiency: 0.85,
      plantingDate: null,
      collection: 'S2',
      ...(item.settings || {}),
    },
    irrigations: item.irrigations || [],
  }))
  await writeAll([...all, ...created])
  return created
}

export async function updateField(id, patch) {
  const all = readAll()
  const idx = all.findIndex((f) => f.id === id)
  if (idx === -1) return null
  const merged = {
    ...all[idx],
    ...patch,
    id,
    settings: { ...all[idx].settings, ...(patch.settings || {}) },
    updatedAt: new Date().toISOString(),
  }
  const next = [...all]
  next[idx] = merged
  await writeAll(next)
  return merged
}

/** ลบหลายแปลงพร้อมกัน — คืนจำนวนที่ลบได้จริง */
export async function deleteFields(ids) {
  const wanted = new Set(ids)
  const all = readAll()
  const next = all.filter((f) => !wanted.has(f.id))
  const removed = all.length - next.length
  if (removed) await writeAll(next)
  return removed
}

/** ล้างแปลงทั้งหมดออกจากระบบ — คืนจำนวนที่ลบไป */
export async function deleteAllFields() {
  const all = readAll()
  if (!all.length) return 0
  await writeAll([])
  return all.length
}

export async function deleteField(id) {
  const all = readAll()
  const next = all.filter((f) => f.id !== id)
  if (next.length === all.length) return false
  await writeAll(next)
  return true
}
