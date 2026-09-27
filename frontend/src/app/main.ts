import 'ant-design-vue/dist/reset.css'
import { createApp } from 'vue'
import App from './App.vue'
import '../shared/styles/base.scss'
import '../shared/styles/designSystem.scss'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { i18n } from '../shared/i18n/index'
import VueDiff from 'vue-diff'

import 'vue-diff/dist/index.css'

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)
createApp(App)
  .use(pinia)
  .use(i18n)
  .use(VueDiff, {
    componentName: 'VueDiff'
  })
  .mount('#omnigallery-app')

window.dispatchEvent(new Event('omnigallery:mounted'))
