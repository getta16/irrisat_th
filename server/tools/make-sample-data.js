/**
 * สร้างไฟล์ตัวอย่างไว้ทดสอบการนำเข้า — Shapefile (.zip), KML และ GeoJSON
 * รันด้วย:  npm run samples
 * ผลลัพธ์อยู่ในโฟลเดอร์ samples/
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', '..', 'samples')

// แปลงนาข้าวสมมติแถบสุพรรณบุรี–ชัยนาท
const FIELDS = [
  { name: 'แปลงนาเหนือ', crop: 'ข้าว', lon: 100.121, lat: 14.478, w: 0.0042, h: 0.0031 },
  { name: 'แปลงนากลาง', crop: 'ข้าว', lon: 100.1272, lat: 14.4742, w: 0.0035, h: 0.0026 },
  { name: 'แปลงอ้อยริมคลอง', crop: 'อ้อย', lon: 100.1185, lat: 14.4705, w: 0.0050, h: 0.0022 },
]

const ringOf = (f) => {
  const [x0, y0, x1, y1] = [f.lon - f.w / 2, f.lat - f.h / 2, f.lon + f.w / 2, f.lat + f.h / 2]
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ]
}

// ── GeoJSON ────────────────────────────────────────────────────────────

const geojson = {
  type: 'FeatureCollection',
  features: FIELDS.map((f) => ({
    type: 'Feature',
    properties: { name: f.name, crop: f.crop },
    geometry: { type: 'Polygon', coordinates: [ringOf(f)] },
  })),
}

// ── KML ────────────────────────────────────────────────────────────────

const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>แปลงตัวอย่าง IrriSAT-TH</name>
${FIELDS.map(
  (f) => `    <Placemark>
      <name>${f.name}</name>
      <description>ชนิดพืช: ${f.crop}</description>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>
        ${ringOf(f)
          .map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)},0`)
          .join(' ')}
      </coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>`
).join('\n')}
  </Document>
</kml>`

// ── Shapefile ──────────────────────────────────────────────────────────
// เขียนเองแบบมินิมอลตามสเปก ESRI (shape type 5 = Polygon) เพื่อไม่ต้องพึ่งไลบรารีเพิ่ม

const SHP_HEADER = 100

function polygonRecordContent(ring) {
  const numPoints = ring.length
  const size = 4 + 32 + 4 + 4 + 4 + numPoints * 16
  const buf = Buffer.alloc(size)
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])

  let o = 0
  buf.writeInt32LE(5, o); o += 4 // shape type: Polygon
  buf.writeDoubleLE(Math.min(...xs), o); o += 8
  buf.writeDoubleLE(Math.min(...ys), o); o += 8
  buf.writeDoubleLE(Math.max(...xs), o); o += 8
  buf.writeDoubleLE(Math.max(...ys), o); o += 8
  buf.writeInt32LE(1, o); o += 4 // numParts
  buf.writeInt32LE(numPoints, o); o += 4
  buf.writeInt32LE(0, o); o += 4 // ตำแหน่งเริ่มต้นของ part แรก
  for (const [x, y] of ring) {
    buf.writeDoubleLE(x, o); o += 8
    buf.writeDoubleLE(y, o); o += 8
  }
  return buf
}

function writeMainHeader(buf, fileLengthBytes, bbox) {
  buf.writeInt32BE(9994, 0) // file code
  buf.writeInt32BE(fileLengthBytes / 2, 24) // ความยาวไฟล์นับเป็น 16-bit word
  buf.writeInt32LE(1000, 28) // version
  buf.writeInt32LE(5, 32) // shape type
  buf.writeDoubleLE(bbox[0], 36)
  buf.writeDoubleLE(bbox[1], 44)
  buf.writeDoubleLE(bbox[2], 52)
  buf.writeDoubleLE(bbox[3], 60)
  // zmin/zmax/mmin/mmax = 0 อยู่แล้วจาก Buffer.alloc
}

function buildShapefile(fields) {
  const rings = fields.map(ringOf)
  const contents = rings.map(polygonRecordContent)

  const all = rings.flat()
  const bbox = [
    Math.min(...all.map((p) => p[0])),
    Math.min(...all.map((p) => p[1])),
    Math.max(...all.map((p) => p[0])),
    Math.max(...all.map((p) => p[1])),
  ]

  const shpParts = []
  const shxEntries = []
  let offsetWords = SHP_HEADER / 2

  contents.forEach((content, i) => {
    const recHeader = Buffer.alloc(8)
    recHeader.writeInt32BE(i + 1, 0)
    recHeader.writeInt32BE(content.length / 2, 4)
    shpParts.push(recHeader, content)
    shxEntries.push({ offsetWords, lengthWords: content.length / 2 })
    offsetWords += (8 + content.length) / 2
  })

  const shpBody = Buffer.concat(shpParts)
  const shp = Buffer.alloc(SHP_HEADER + shpBody.length)
  writeMainHeader(shp, shp.length, bbox)
  shpBody.copy(shp, SHP_HEADER)

  const shx = Buffer.alloc(SHP_HEADER + shxEntries.length * 8)
  writeMainHeader(shx, shx.length, bbox)
  shxEntries.forEach((e, i) => {
    shx.writeInt32BE(e.offsetWords, SHP_HEADER + i * 8)
    shx.writeInt32BE(e.lengthWords, SHP_HEADER + i * 8 + 4)
  })

  return { shp, shx, bbox }
}

/** dBase III: ตาราง attribute ของ shapefile */
function buildDbf(rows, fields) {
  const headerLength = 32 + fields.length * 32 + 1
  const recordLength = 1 + fields.reduce((s, f) => s + f.size, 0)
  const buf = Buffer.alloc(headerLength + rows.length * recordLength + 1)

  buf.writeUInt8(0x03, 0) // dBase III ไม่มี memo
  const now = new Date()
  buf.writeUInt8(now.getFullYear() - 1900, 1)
  buf.writeUInt8(now.getMonth() + 1, 2)
  buf.writeUInt8(now.getDate(), 3)
  buf.writeUInt32LE(rows.length, 4)
  buf.writeUInt16LE(headerLength, 8)
  buf.writeUInt16LE(recordLength, 10)

  fields.forEach((f, i) => {
    const at = 32 + i * 32
    buf.write(f.name.slice(0, 10), at, 11, 'ascii')
    buf.write(f.type, at + 11, 1, 'ascii')
    buf.writeUInt8(f.size, at + 16)
    buf.writeUInt8(f.decimals || 0, at + 17)
  })
  buf.writeUInt8(0x0d, headerLength - 1) // จบส่วนนิยามฟิลด์

  let o = headerLength
  for (const row of rows) {
    buf.write(' ', o, 1, 'ascii') // ธงว่าเรคคอร์ดยังไม่ถูกลบ
    let col = o + 1
    for (const f of fields) {
      const raw = String(row[f.name] ?? '')
      // dBase III รองรับแค่ 1 ไบต์ต่อตัวอักษร — ข้อความไทยจึงเก็บเป็น UTF-8 แล้วบอกไว้ใน .cpg
      const bytes = Buffer.from(raw, 'utf8').subarray(0, f.size)
      Buffer.alloc(f.size, 0x20).copy(buf, col)
      bytes.copy(buf, col)
      col += f.size
    }
    o += recordLength
  }
  buf.writeUInt8(0x1a, buf.length - 1) // end of file

  return buf
}

const PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]'

async function main() {
  fs.mkdirSync(OUT, { recursive: true })

  fs.writeFileSync(path.join(OUT, 'sample-fields.geojson'), JSON.stringify(geojson, null, 2), 'utf8')
  fs.writeFileSync(path.join(OUT, 'sample-fields.kml'), kml, 'utf8')

  const { shp, shx } = buildShapefile(FIELDS)
  const dbf = buildDbf(
    FIELDS.map((f) => ({ NAME: f.name, CROP: f.crop })),
    [
      { name: 'NAME', type: 'C', size: 60 },
      { name: 'CROP', type: 'C', size: 30 },
    ]
  )

  const zip = new JSZip()
  zip.file('sample-fields.shp', shp)
  zip.file('sample-fields.shx', shx)
  zip.file('sample-fields.dbf', dbf)
  zip.file('sample-fields.prj', PRJ)
  zip.file('sample-fields.cpg', 'UTF-8')
  const zipped = await zip.generateAsync({ type: 'nodebuffer' })
  fs.writeFileSync(path.join(OUT, 'sample-fields-shapefile.zip'), zipped)

  // เขียนไฟล์แยกไว้ด้วย เผื่อทดสอบการเลือกหลายไฟล์พร้อมกัน
  const loose = path.join(OUT, 'shapefile-แยกไฟล์')
  fs.mkdirSync(loose, { recursive: true })
  fs.writeFileSync(path.join(loose, 'sample-fields.shp'), shp)
  fs.writeFileSync(path.join(loose, 'sample-fields.shx'), shx)
  fs.writeFileSync(path.join(loose, 'sample-fields.dbf'), dbf)
  fs.writeFileSync(path.join(loose, 'sample-fields.prj'), PRJ, 'utf8')
  fs.writeFileSync(path.join(loose, 'sample-fields.cpg'), 'UTF-8', 'utf8')

  console.log(`สร้างไฟล์ตัวอย่างเรียบร้อยที่ ${OUT}`)
  for (const f of fs.readdirSync(OUT)) console.log('  •', f)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
