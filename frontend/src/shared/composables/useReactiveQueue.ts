import { reactive } from 'vue'
import { FetchQueue } from 'vue3-ts-util'
export const createReactiveQueue = () => reactive(new FetchQueue(-1, 0, -1, 'throw'))
