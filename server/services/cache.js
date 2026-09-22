import { createHash } from 'node:crypto'

/**
 * แคชผลลัพธ์ในหน่วยความจำ ใช้ร่วมกันทั้งหน้าเว็บ (/api/analysis) และ API ภายนอก (/api/v1)
 * GEE กับ NASA POWER ตอบช้าและมีโควตา จึงไม่ควรเรียกซ้ำถี่ ๆ
 *
 * เก็บเป็น Promise ไม่ใช่ค่า — คำขอที่ซ้อนกันเข้ามาระหว่างรอผลจะได้รอก้อนเดียวกัน
 * แทนที่จะยิงไป Earth Engine ซ้ำ ถ้าล้มเหลวจะลบทิ้งทันทีให้คำขอถัดไปลองใหม่ได้
 */
const cache = new Map()
const TTL_MS = 30 * 60 * 1000
const MAX_ENTRIES = 500

export function cached(key, producer) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const value = producer().catch((err) => {
    cache.delete(key)
    throw err
  })
  cache.set(key, { at: Date.now(), value })
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value)
  return value
}

/**
 * คีย์แทน geometry — ต้องครอบคลุมพิกัดทุกจุด ไม่อย่างนั้นแปลงที่ติดกัน
 * (ขึ้นต้นด้วยพิกัดชุดเดียวกัน) จะได้ผล NDVI ของกันและกัน
 */
export const geomKey = (geometry) => createHash('sha1').update(JSON.stringify(geometry)).digest('base64url')
