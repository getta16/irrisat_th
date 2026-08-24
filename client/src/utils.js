/** สีประจำแปลง — วนตามลำดับ เพื่อให้แยกแปลงบนแผนที่ได้ง่าย */
export const FIELD_COLORS = [
  '#e8a33d',
  '#2f7ec2',
  '#c9553d',
  '#7b57c4',
  '#159c7a',
  '#d1478f',
  '#5b8c2a',
  '#c07c2c',
]

export const colorFor = (index) => FIELD_COLORS[index % FIELD_COLORS.length]

export const fmt = (v, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits)

export const fmtArea = (rai) => (rai >= 100 ? `${fmt(rai, 0)} ไร่` : `${fmt(rai, 2)} ไร่`)

export const thaiDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

export const isoDate = (d) => d.toISOString().slice(0, 10)

export const shiftDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** สร้างไฟล์ CSV แล้วสั่งดาวน์โหลดในเบราว์เซอร์ */
export function downloadCsv(filename, rows) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n')
  // BOM เพื่อให้ Excel ภาษาไทยอ่านออก
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
