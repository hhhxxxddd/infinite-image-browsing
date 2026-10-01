import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_THEME, mergeMantineTheme } from '@mantine/core'
import { appTheme } from './theme.ts'
import { tagColorPresets } from './tagColors.ts'

const globalCss = readFileSync(new URL('./global.css', import.meta.url), 'utf8')
const editorCss = readFileSync(new URL('../features/editors/editor.css', import.meta.url), 'utf8')
const tokens = (block) =>
  Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()])
  )
const light = tokens(globalCss.match(/\[data-mantine-color-scheme='light'\]\s*\{([^}]+)\}/)[1])
const dark = tokens(globalCss.match(/\[data-mantine-color-scheme='dark'\],[\s\S]*?\{([^}]+)\}/)[1])
const editor = { ...dark, ...tokens(editorCss.match(/\.react-editor-shell\s*\{([^}]+)\}/)[1]) }
const resolve = (value, palette) =>
  value.startsWith('var(') ? resolve(palette[value.slice(4, -1)], palette) : value

function luminance(hex) {
  const normalized =
    hex.length === 4 ? '#' + [...hex.slice(1)].map((part) => part + part).join('') : hex
  const channels = normalized
    .slice(1)
    .match(/../g)
    .map((part) => parseInt(part, 16) / 255)
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  )
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

test('preset tag labels and selected swatch checks are readable on every preset', () => {
  for (const preset of tagColorPresets) {
    assert.ok(contrast('#fff', preset.color) >= 4.5, `${preset.name} label contrast`)
  }
})

test('light and dark text, primary actions, selections and semantic badges remain readable', () => {
  for (const [scheme, palette] of Object.entries({ light, dark })) {
    for (const [ink, background] of [
      ['ink', 'surface'],
      ['muted', 'surface'],
      ['action-ink', 'action-fill'],
      ['action-ink', 'action-hover'],
      ['accent-ink', 'accent-soft'],
      ['nav-ink', 'nav-selected'],
      ['success-ink', 'success-soft'],
      ['warning-ink', 'warning-soft'],
      ['danger-ink', 'danger-soft']
    ]) {
      const ratio = contrast(palette[`--omni-${ink}`], palette[`--omni-${background}`])
      assert.ok(ratio >= 4.5, `${scheme} ${ink}/${background}: ${ratio.toFixed(2)}:1`)
    }
  }
})

test('editor track labels and selection indicators stay distinct on the shared dark surfaces', () => {
  for (const kind of ['media', 'text']) {
    const fill = resolve(editor[`--omni-track-${kind}-fill`], editor)
    const ink = resolve(editor[`--omni-track-${kind}-ink`], editor)
    const border = resolve(editor[`--omni-track-${kind}-border`], editor)
    assert.ok(contrast(ink, fill) >= 4.5, `${kind} track labels`)
    assert.ok(contrast(border, fill) >= 3, `${kind} track edges`)
  }
  assert.ok(
    contrast(resolve(editor['--omni-editor-accent'], editor), editor['--omni-editor-panel']) >= 3
  )
})

test('filled palette controls resolve text for both schemes instead of reusing white on a pale dark-mode fill', () => {
  const theme = mergeMantineTheme(DEFAULT_THEME, appTheme)
  for (const color of ['blue', 'graphite', 'green', 'red', 'yellow']) {
    const result = theme.variantColorResolver({ theme, color, variant: 'filled' })
    const foregrounds = result.color.match(/var\(--mantine-color-(white|black)\)/g)
    assert.equal(foregrounds.length, 2)
    for (const [index, scheme] of ['light', 'dark'].entries()) {
      const foreground = foregrounds[index].includes('white') ? theme.white : theme.black
      assert.ok(
        contrast(foreground, theme.colors[color][theme.primaryShade[scheme]]) >= 4.5,
        `${color} ${scheme}`
      )
    }
  }
})

test('white cover controls keep a readable foreground independent of the app scheme', () => {
  const theme = mergeMantineTheme(DEFAULT_THEME, appTheme)
  for (const color of ['blue', 'gray', 'green', 'red', 'yellow']) {
    const result = theme.variantColorResolver({ theme, color, variant: 'white' })
    assert.ok(contrast(result.color, theme.white) >= 4.5, `${color} on white cover controls`)
  }
})
