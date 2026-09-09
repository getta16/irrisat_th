/**
 * เก็บข้อมูลแปลงเป็น JSON ก้อนเดียว โดยแต่ละแปลงจำเจ้าของไว้ในตัวมันเอง
 * (`ownerId` = Google sub, `ownerEmail` = อีเมล) แล้วกรองตามเจ้าของตอนอ่าน
 * ทุกฟังก์ชันที่อ่าน/เขียนจึงรับ `owner` เป็นตัวสุดท้ายเสมอ ห้ามข้าม
 * ถ้าจำนวนผู้ใช้โตจนไฟล์เดียวไม่ไหว ให้เปลี่ยนเฉพาะไฟล์นี้เป็น SQLite/Postgres
 *
 * owner = { id, email }  — ผู้ใช้ที่ล็อกอินอยู่
 * owner = null           — ไม่ได้บังคับล็อกอิน (ไม่ได้ตั้ง GOOGLE_CLIENT_ID)
 *                          ถือเป็นโหมดผู้ใช้คนเดียว จึงเห็นทุกแปลงเหมือนเดิม
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
import { FIELDS_FILE, GCS_BUCKET, GCS_FIELDS_OBJECT, LEGACY_OWNER_EMAIL } from '../config.js'

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

/** แปลงที่ยังไม่มีเจ้าของ — บันทึกไว้ตั้งแต่ก่อนเปิดใช้การล็อกอิน */
const isOrphan = (field) => !field.ownerId && !field.ownerEmail

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

  const orphans = cache.filter(isOrphan).length
  let claimed = 0

  // แปลงที่บันทึกไว้ก่อนมีระบบล็อกอินยังไม่มีเจ้าของ ถ้าไม่โอนให้ใคร
  // จะไม่มีใครเห็นเลยเมื่อเปิดใช้การล็อกอิน — ตั้ง LEGACY_OWNER_EMAIL เพื่อโอนให้บัญชีนั้น
  if (orphans && LEGACY_OWNER_EMAIL) {
    try {
      await writeAll(cache.map((f) => (isOrphan(f) ? { ...f, ownerEmail: LEGACY_OWNER_EMAIL } : f)))
      claimed = orphans
    } catch (e) {
      console.error('โอนแปลงเก่าให้เจ้าของไม่สำเร็จ:', e.message)
    }
  }

  return {
    count: cache.length,
    where: GCS_BUCKET ? 'gcs' : 'file',
    failed: loadFailed,
    orphans: claimed ? 0 : orphans,
    claimed,
  }
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

/**
 * แปลงนี้เป็นของผู้ใช้คนนี้ไหม
 * เทียบด้วย ownerId (Google sub) ก่อนเพราะไม่มีวันเปลี่ยน ส่วน ownerEmail
 * ไว้รองรับแปลงที่โอนมาด้วย LEGACY_OWNER_EMAIL ซึ่งยังไม่รู้ sub จนกว่าเจ้าตัวจะล็อกอิน
 */
function owns(field, owner) {
  if (!owner) return true // โหมดไม่บังคับล็อกอิน — เห็นทุกแปลง
  if (field.ownerId) return field.ownerId === owner.id
  if (field.ownerEmail) return field.ownerEmail === owner.email
  return false // ไม่มีเจ้าของ และยังไม่ได้โอนให้ใคร
}

export const listFields = (owner) => readAll().filter((f) => owns(f, owner))

/** คืน null ทั้งกรณีไม่มีแปลงนี้และกรณีเป็นของคนอื่น — จะได้ไม่บอกใบ้ว่ามีแปลงนั้นอยู่ */
export const getField = (id, owner) => readAll().find((f) => f.id === id && owns(f, owner)) || null

/**
 * @param {Array} items แปลงที่ผ่าน normalizeToFields มาแล้ว
 * @param {object} [opts]
 * @param {{id: string, email: string}|null} [opts.owner] เจ้าของแปลงชุดนี้
 * @param {boolean} [opts.replace=false] ลบแปลงเดิม**ของเจ้าของคนนี้**ทิ้งก่อนบันทึกชุดใหม่
 */
export async function createFields(items, opts = {}) {
  const owner = opts.owner || null
  // replace ต้องไม่แตะแปลงของคนอื่น — เก็บของคนอื่นไว้ครบเสมอ
  const all = opts.replace ? readAll().filter((f) => !owns(f, owner)) : readAll()
  const now = new Date().toISOString()
  const created = items.map((item) => ({
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    ownerId: owner?.id || null,
    ownerEmail: owner?.email || null,
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

export async function updateField(id, patch, owner) {
  const all = readAll()
  const idx = all.findIndex((f) => f.id === id && owns(f, owner))
  if (idx === -1) return null
  const merged = {
    ...all[idx],
    ...patch,
    id,
    // แปลงที่โอนมาด้วยอีเมลยังไม่รู้ sub ตอนนั้น — ถือโอกาสประทับไว้ตอนเจ้าตัวแก้ครั้งแรก
    ownerId: all[idx].ownerId || owner?.id || null,
    ownerEmail: all[idx].ownerEmail || owner?.email || null,
    settings: { ...all[idx].settings, ...(patch.settings || {}) },
    updatedAt: new Date().toISOString(),
  }
  const next = [...all]
  next[idx] = merged
  await writeAll(next)
  return merged
}

/** ลบหลายแปลงพร้อมกัน เฉพาะที่เป็นของเจ้าของคนนี้ — คืนจำนวนที่ลบได้จริง */
export async function deleteFields(ids, owner) {
  const wanted = new Set(ids)
  const all = readAll()
  const next = all.filter((f) => !(wanted.has(f.id) && owns(f, owner)))
  const removed = all.length - next.length
  if (removed) await writeAll(next)
  return removed
}

/** ล้างแปลงของเจ้าของคนนี้ทั้งหมด — คืนจำนวนที่ลบไป (ของคนอื่นไม่ถูกแตะ) */
export async function deleteAllFields(owner) {
  const all = readAll()
  const next = all.filter((f) => !owns(f, owner))
  const removed = all.length - next.length
  if (!removed) return 0
  await writeAll(next)
  return removed
}

export async function deleteField(id, owner) {
  const all = readAll()
  const next = all.filter((f) => !(f.id === id && owns(f, owner)))
  if (next.length === all.length) return false
  await writeAll(next)
  return true
}
