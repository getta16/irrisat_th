import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// GitHub Pages เสิร์ฟที่ https://<user>.github.io/<repo>/ ไม่ใช่ราก
// จึงต้องตั้ง base ให้ตรง — workflow จะส่ง VITE_BASE=/irrisat_th/ มาให้ตอน build
// ส่วนตอนรันในเครื่องปล่อยว่างไว้ ใช้ '/' ตามปกติ
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  build: {
    // สองหน้า: แผนที่หลัก และหน้า API ข้อมูลแปลง (developers.html)
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        developers: fileURLToPath(new URL('./developers.html', import.meta.url)),
      },
    },
  },
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
