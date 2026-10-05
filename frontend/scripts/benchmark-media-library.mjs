import { performance } from 'node:perf_hooks'
import { layoutMasonry, mediaCardRatio } from '../react/features/media/masonryModel.ts'

const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
const results = []
for (const count of [1000, 10000, 50000]) {
  const items = Array.from({ length: count }, (_, index) => ({
    name: `${index}.png`,
    fullpath: `C:/bench/${index}.png`,
    width: [1920, 1024, 640][index % 3],
    height: [1080, 1024, 1280][index % 3]
  }))
  layoutMasonry(items, 1060, 200, mediaCardRatio)
  const times = []
  for (let round = 0; round < 9; round++) {
    items[round].width = 1100 + round
    const start = performance.now()
    layoutMasonry(items, 1060, 200, mediaCardRatio)
    times.push(performance.now() - start)
  }
  results.push({
    items: count,
    layout_ms: +median(times).toFixed(3)
  })
}
console.log(JSON.stringify({ node: process.version, results }, null, 2))
