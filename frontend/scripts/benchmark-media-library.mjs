import { performance } from 'node:perf_hooks'
import { computed, reactive, ref, toRaw } from 'vue'
import { layoutMasonry } from '../src/features/media-library/model/masonryLayout.ts'

const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
const results = []
for (const count of [1000, 10000, 50000]) {
  const items = Array.from({ length: count }, (_, index) => ({
    name: `${index}.png`,
    fullpath: `C:/bench/${index}.png`,
    width: 1024,
    height: 1024
  }))
  const state = reactive({ items })
  const measured = reactive(new Map())
  const full = computed(() => layoutMasonry(state.items, 5, 200, measured))
  full.value
  const fullTimes = []
  for (let round = 0; round < 9; round++) {
    measured.set(items[round].fullpath, { width: 1100 + round, height: 1000 })
    const start = performance.now()
    full.value
    fullTimes.push(performance.now() - start)
  }
  const dimensions = new Map()
  const revision = ref(0)
  let previous
  const cached = computed(() => {
    void revision.value
    previous = layoutMasonry(
      toRaw(state.items).map((item) => toRaw(item)),
      5,
      200,
      dimensions,
      previous
    )
    return previous
  })
  cached.value
  const cachedTimes = []
  for (let round = 0; round < 9; round++) {
    dimensions.set(items[round].fullpath, { width: 1100 + round, height: 1000 })
    revision.value++
    const start = performance.now()
    cached.value
    cachedTimes.push(performance.now() - start)
  }
  results.push({
    items: count,
    reactiveFullLayout_ms: +median(fullTimes).toFixed(3),
    cachedRawLayout_ms: +median(cachedTimes).toFixed(3)
  })
}
console.log(JSON.stringify({ node: process.version, results }, null, 2))
