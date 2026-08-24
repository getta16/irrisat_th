import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages เสิร์ฟที่ https://<user>.github.io/<repo>/ ไม่ใช่ราก
// จึงต้องตั้ง base ให้ตรง — workflow จะส่ง VITE_BASE=/irrisat_th/ มาให้ตอน build
// ส่วนตอนรันในเครื่องปล่อยว่างไว้ ใช้ '/' ตามปกติ
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5174',
        changeOrigin: true,
      },
    },
  },
})
