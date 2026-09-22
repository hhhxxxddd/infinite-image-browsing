import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers'
import vueJsx from '@vitejs/plugin-vue-jsx'
import { env } from 'node:process'
const isProd = env.NODE_ENV === 'production'
const isDev = !isProd
const isTauri = !!env.TAURI_ARCH
// https://vitejs.dev/config/

export default defineConfig({
  base: isDev || isTauri ? '/' : '/infinite_image_browsing/fe-static',
  
  envPrefix: ['VITE_', 'TAURI_'],
  plugins: [
    vue(),
    vueJsx(),
    Components({
      resolvers: [AntDesignVueResolver({ importStyle: false })]
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 3002,
    strictPort: true,
    proxy: {
      '/infinite_image_browsing/': {
        target: 'http://127.0.0.1:7877/'
      }
    }
  }
})
