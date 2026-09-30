import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers'
import vueJsx from '@vitejs/plugin-vue-jsx'
import react from '@vitejs/plugin-react'
import { env } from 'node:process'
const isProd = env.NODE_ENV === 'production'
const isDev = !isProd
const isTauri = !!env.TAURI_ARCH
// https://vitejs.dev/config/

export default defineConfig({
  base: isDev || isTauri ? '/' : '/static/',

  envPrefix: ['VITE_', 'TAURI_'],
  plugins: [
    vue(),
    vueJsx(),
    react(),
    Components({
      dirs: ['src/shared/ui', 'src/features'],
      deep: true,
      resolvers: [AntDesignVueResolver({ importStyle: false })],
      types: []
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    rolldownOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        react: fileURLToPath(new URL('./react.html', import.meta.url)),
        legacy: fileURLToPath(new URL('./legacy.html', import.meta.url))
      }
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
