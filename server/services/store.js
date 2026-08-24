/**
 * เก็บข้อมูลแปลงลงไฟล์ JSON ไฟล์เดียว — พอสำหรับการใช้งานคนเดียว
 * ถ้าจะขยายเป็นหลายผู้ใช้ในอนาคต ให้เปลี่ยนเฉพาะไฟล์นี้เป็น SQLite/Postgres
 */
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { FIELDS_FILE } from '../config.js'

function readAll() {
  try {
    if (!fs.existsSync(FIELDS_FILE)) return []
    const raw = fs.readFileSync(FIELDS_FILE, 'utf8').trim()
    return raw ? JSON.parse(raw) : []
  } catch (e) {
    console.error('อ่านไฟล์ข้อมูลแปลงไม่สำเร็จ:', e.message)
    return []
  }
}

let queue = Promise.resolve()

/** เขียนแบบ atomic (เขียนไฟล์ชั่วคราวแล้ว rename) และเข้าคิวกันเขียนชนกัน */
function writeAll(fields) {
  queue = queue.then(() => {
    const tmp = `${FIELDS_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(fields, null, 2), 'utf8')
    fs.renameSync(tmp, FIELDS_FILE)
  })
  return queue.then(() => fields)
}

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
  all[idx] = merged
  await writeAll(all)
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
