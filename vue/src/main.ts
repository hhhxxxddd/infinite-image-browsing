import 'ant-design-vue/dist/reset.css'
import { createApp } from 'vue'
import App from './App.vue'
import './index.scss'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { i18n } from './i18n'
import VueDiff from 'vue-diff'

import 'vue-diff/dist/index.css';

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)
createApp(App)
  .use(pinia)
  .use(i18n)
  .use(VueDiff, {
    componentName: 'VueDiff',
  })
  .mount('#iib-app')


window.dispatchEvent(new Event('iib:mounted'))
