import { Router } from 'express'
import { normalizeToFields } from '../services/normalize.js'
import {
  listFields,
  getField,
  createFields,
  updateField,
  deleteField,
  deleteFields,
  deleteAllFields,
} from '../services/store.js'

const router = Router()

const isTrue = (v) => v === true || v === 'true' || v === '1' || v === 1

router.get('/', (_req, res) => {
  res.json({ fields: listFields() })
})

router.get('/:id', (req, res) => {
  const field = getField(req.params.id)
  if (!field) return res.status(404).json({ error: 'ไม่พบแปลงนี้' })
  res.json({ field })
})

/**
 * POST /api/fields
 * รับได้ทั้ง { fields: [...] } ที่ผ่าน /api/import มาแล้ว
 * หรือ { geojson: FeatureCollection } ตรง ๆ (เช่น รูปที่วาดบนแผนที่)
 *
 * ใส่ { replace: true } มาด้วย = ลบแปลงเดิมทั้งหมดทิ้ง แล้วใช้ชุดที่ส่งมาแทน
 */
router.post('/', async (req, res) => {
  try {
    let items = req.body.fields

    if (!items && req.body.geojson) {
      const { fields, skipped } = normalizeToFields(req.body.geojson, { pointBufferM: 50 })
      if (!fields.length) {
        return res.status(422).json({ error: 'รูปทรงที่ส่งมาใช้เป็นแปลงไม่ได้', skipped })
      }
      items = fields
    }

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'ต้องส่ง fields หรือ geojson มาด้วย' })
    }

    const invalid = items.find((f) => !f.geometry || !['Polygon', 'MultiPolygon'].includes(f.geometry.type))
    if (invalid) return res.status(400).json({ error: 'ทุกแปลงต้องเป็นรูปทรงแบบพื้นที่ (Polygon)' })

    const replace = isTrue(req.body.replace)
    const removed = replace ? listFields().length : 0

    const created = await createFields(items, { replace })
    res.status(201).json({ fields: created, replaced: removed })
  } catch (err) {
    console.error('create fields failed:', err)
    res.status(500).json({ error: 'บันทึกแปลงไม่สำเร็จ', detail: String(err?.message || err) })
  }
})

/**
 * DELETE /api/fields        body { ids: [...] }  — ลบเฉพาะที่ระบุ
 * DELETE /api/fields?all=1                       — ล้างแปลงทั้งหมด
 */
router.delete('/', async (req, res) => {
  try {
    if (isTrue(req.query.all)) {
      const removed = await deleteAllFields()
      return res.json({ removed })
    }

    const ids = req.body?.ids
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'ต้องส่ง ids ของแปลงที่จะลบ หรือใช้ ?all=1 เพื่อลบทั้งหมด' })
    }
    const removed = await deleteFields(ids)
    res.json({ removed })
  } catch (err) {
    console.error('delete fields failed:', err)
    res.status(500).json({ error: 'ลบแปลงไม่สำเร็จ', detail: String(err?.message || err) })
  }
})

router.patch('/:id', async (req, res) => {
  const allowed = ['name', 'settings', 'irrigations', 'properties']
  const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)))
  const updated = await updateField(req.params.id, patch)
  if (!updated) return res.status(404).json({ error: 'ไม่พบแปลงนี้' })
  res.json({ field: updated })
})

router.delete('/:id', async (req, res) => {
  const ok = await deleteField(req.params.id)
  if (!ok) return res.status(404).json({ error: 'ไม่พบแปลงนี้' })
  res.status(204).end()
})

export default router
