import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { env } from 'node:process'
const isProd = env.NODE_ENV === 'production'
const isDev = !isProd
const isTauri = !!env.TAURI_ARCH
// https://vitejs.dev/config/

export default defineConfig({
  base: isDev || isTauri ? '/' : '/static/',

  envPrefix: ['VITE_', 'TAURI_'],
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 3002,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7877'
      }
    }
  }
})
