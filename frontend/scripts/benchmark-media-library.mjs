import { performance } from 'node:perf_hooks'
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
  const measured = new Map()
  layoutMasonry(items, 5, 200, measured)
  const fullTimes = []
  for (let round = 0; round < 9; round++) {
    measured.set(items[round].fullpath, { width: 1100 + round, height: 1000 })
    const start = performance.now()
    layoutMasonry(items, 5, 200, measured)
    fullTimes.push(performance.now() - start)
  }
  const dimensions = new Map()
  let previous = layoutMasonry(items, 5, 200, dimensions)
  const cachedTimes = []
  for (let round = 0; round < 9; round++) {
    dimensions.set(items[round].fullpath, { width: 1100 + round, height: 1000 })
    const start = performance.now()
    previous = layoutMasonry(items, 5, 200, dimensions, previous)
    cachedTimes.push(performance.now() - start)
  }
  results.push({
    items: count,
    fullLayout_ms: +median(fullTimes).toFixed(3),
    cachedLayout_ms: +median(cachedTimes).toFixed(3)
  })
}
console.log(JSON.stringify({ node: process.version, results }, null, 2))
