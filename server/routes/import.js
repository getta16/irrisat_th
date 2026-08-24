import { Router } from 'express'
import multer from 'multer'
import { MAX_UPLOAD_MB } from '../config.js'
import { parseUploadedFiles, ParseError, COMMON_CRS } from '../services/parseGeo.js'
import { normalizeToFields } from '../services/normalize.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 20 },
})

router.get('/crs', (_req, res) => {
  res.json({
    supported: Object.keys(COMMON_CRS).map(Number),
    labels: {
      4326: 'WGS 84 — ละติจูด/ลองจิจูด',
      3857: 'Web Mercator',
      32647: 'WGS 84 / UTM Zone 47N (ไทยฝั่งตะวันตก)',
      32648: 'WGS 84 / UTM Zone 48N (ไทยฝั่งตะวันออก)',
      24047: 'Indian 1975 / UTM Zone 47N',
      24048: 'Indian 1975 / UTM Zone 48N',
    },
  })
})

/**
 * POST /api/import
 * multipart/form-data:  files[] + (ตัวเลือก) epsg, pointBufferM
 * คืน FeatureCollection ที่พร้อมแสดงบนแผนที่ — ยังไม่บันทึกลงฐานข้อมูล
 */
router.post('/', upload.array('files', 20), async (req, res) => {
  try {
    const fc = await parseUploadedFiles(req.files, req.body.epsg || req.query.epsg)
    const { fields, skipped } = normalizeToFields(fc, {
      pointBufferM: req.body.pointBufferM !== undefined ? Number(req.body.pointBufferM) : 50,
    })

    if (!fields.length) {
      return res.status(422).json({
        error: 'ไม่พบพื้นที่ที่ใช้งานได้ในไฟล์',
        hint: 'ไฟล์อาจมีแต่จุดหรือเส้น หรือรูปทรงเล็กเกินไป',
        skipped,
      })
    }

    res.json({
      sourceFiles: req.files.map((f) => f.originalname),
      count: fields.length,
      skipped,
      fields,
    })
  } catch (err) {
    if (err instanceof ParseError) {
      return res.status(400).json({ error: err.message, hint: err.hint })
    }
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `ไฟล์ใหญ่เกิน ${MAX_UPLOAD_MB} MB` })
    }
    console.error('import failed:', err)
    res.status(500).json({ error: 'ประมวลผลไฟล์ไม่สำเร็จ', detail: String(err?.message || err) })
  }
})

export default router
