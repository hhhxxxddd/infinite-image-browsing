import { useEffect, useRef, useState } from 'react'
import starTrails from './assets/star-trails.webp'
import milkyWay from './assets/milky-way.webp'
import starField from './assets/star-field.webp'

const skies = [
  { id: 'star-trails', src: starTrails },
  { id: 'milky-way', src: milkyWay },
  { id: 'star-field', src: starField }
]
const rotationInterval = 30_000

/** Keep the decorative slideshow's timer and renders separate from workspace cards. */
export default function WorkbenchSkyBackdrop({ active }: { active: boolean }) {
  const [current, setCurrent] = useState(0)
  const [loaded, setLoaded] = useState<number[]>([])
  const ready = useRef(new Set<number>())

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timer: ReturnType<typeof setInterval> | undefined
    const stop = () => {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    }
    const resume = () => {
      stop()
      if (!active || document.hidden || motion.matches) return
      timer = setInterval(() => {
        setCurrent((previous) => {
          for (let offset = 1; offset < skies.length; offset++) {
            const next = (previous + offset) % skies.length
            if (ready.current.has(next)) return next
          }
          return previous
        })
      }, rotationInterval)
    }
    resume()
    document.addEventListener('visibilitychange', resume)
    motion.addEventListener('change', resume)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', resume)
      motion.removeEventListener('change', resume)
    }
  }, [active])

  return (
    <div className="wb-home-backdrop" aria-hidden="true" data-sky={skies[current].id}>
      {skies.map((sky, index) => (
        <img
          key={sky.id}
          src={sky.src}
          alt=""
          draggable={false}
          decoding="async"
          fetchPriority="low"
          data-active={current === index && loaded.includes(index)}
          onLoad={() => {
            ready.current.add(index)
            setLoaded([...ready.current])
          }}
          onError={() => {
            ready.current.delete(index)
            setLoaded([...ready.current])
          }}
        />
      ))}
    </div>
  )
}
