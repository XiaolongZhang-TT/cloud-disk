import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BACKEND = 'http://127.0.0.1:18080'

const proxy = {
  '/api': { target: BACKEND, changeOrigin: true },
  '/dav': { target: BACKEND, changeOrigin: true },
  '/Tern': { target: BACKEND, changeOrigin: true },
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy,
  },
  preview: {
    host: '127.0.0.1',
    port: 15173,
    strictPort: true,
    proxy,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
