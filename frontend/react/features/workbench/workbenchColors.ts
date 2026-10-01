import type { CSSProperties } from 'react'
import { readWorkspaceColor } from '../../../src/features/workspaces/model/workspaceColor.ts'

export const workbenchColorPresets = [
  { id: 'space-black', name: '深空黑', color: '#535457', token: 'creative-space-black' },
  { id: 'silver', name: '银', color: '#bfc3c8', token: 'creative-silver' },
  { id: 'starlight', name: '星光', color: '#d9cdb8', token: 'creative-starlight' },
  { id: 'midnight', name: '午夜', color: '#354355', token: 'creative-midnight' },
  { id: 'sky-blue', name: '天蓝', color: '#b9d0de', token: 'creative-sky-blue' },
  { id: 'blue', name: '雾蓝', color: '#6591b6', token: 'accent' },
  { id: 'mint', name: '青绿', color: '#579789', token: 'success' },
  { id: 'clay', name: '陶土橙', color: '#b8755f', token: 'creative-clay' },
  { id: 'rose', name: '灰玫瑰', color: '#b37982', token: 'creative-rose' }
] as const

function automaticPreset(id: string) {
  let hash = 0
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return workbenchColorPresets[((hash ^ (hash >>> 16)) >>> 0) % workbenchColorPresets.length]
}

function mix(color: string, anchor: string, amount: number) {
  const channels = (hex: string) =>
    [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
  const source = channels(color)
  return (
    '#' +
    channels(anchor)
      .map((channel, index) =>
        Math.round(source[index] * (1 - amount) + channel * amount)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}

/** Keep arbitrary custom hues readable without filling cards with saturated color. */
export function customWorkbenchPalette(color: string) {
  const source = readWorkspaceColor(color)
  if (!source) throw new Error('Invalid workspace color')
  return {
    light: { soft: mix(source, '#ffffff', 0.9), ink: mix(source, '#000000', 0.6) },
    dark: { soft: mix(source, '#252628', 0.85), ink: mix(source, '#ffffff', 0.76) }
  }
}

function presetAccentProps(preset: (typeof workbenchColorPresets)[number]) {
  return {
    'data-accent': preset.id,
    style: {
      '--wb-accent-soft': `var(--omni-${preset.token}-soft)`,
      '--wb-accent-ink': `var(--omni-${preset.token}-ink)`
    } as CSSProperties
  }
}

export function workbenchAccentProps(id: string, value?: string) {
  const color = readWorkspaceColor(value)
  if (!color) return presetAccentProps(automaticPreset(id))
  const preset = workbenchColorPresets.find((item) => item.color === color)
  if (preset) return presetAccentProps(preset)
  const { light, dark } = customWorkbenchPalette(color)
  return {
    'data-accent': 'custom',
    style: {
      '--wb-accent-soft': `light-dark(${light.soft}, ${dark.soft})`,
      '--wb-accent-ink': `light-dark(${light.ink}, ${dark.ink})`
    } as CSSProperties
  }
}
