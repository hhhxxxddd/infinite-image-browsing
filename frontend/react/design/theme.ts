import {
  Button,
  Checkbox,
  Radio,
  SegmentedControl,
  Switch,
  Tabs,
  createTheme,
  defaultVariantColorsResolver,
  getContrastColor,
  type MantineColorsTuple
} from '@mantine/core'

const blue: MantineColorsTuple = [
  '#f2f6fc',
  '#e8f0fb',
  '#b8d5f8',
  '#8cb8ed',
  '#72a2dc',
  '#5285c8',
  '#356cb6',
  '#28558a',
  '#24364d',
  '#15283e'
]

const green: MantineColorsTuple = [
  '#edf7f2',
  '#e4f2ea',
  '#b9decc',
  '#89c3ad',
  '#62ab90',
  '#419475',
  '#28795c',
  '#24654e',
  '#234a3b',
  '#183c2e'
]

const amber: MantineColorsTuple = [
  '#fbf5e9',
  '#f8eed8',
  '#ecd4a5',
  '#e0bc7a',
  '#c9a45e',
  '#a78034',
  '#8c651c',
  '#785619',
  '#51412c',
  '#3c2e19'
]

const red: MantineColorsTuple = [
  '#fcf0f1',
  '#f8e8e9',
  '#efc3c6',
  '#e6a1a5',
  '#d98086',
  '#ca626a',
  '#b8474e',
  '#9d363e',
  '#612e33',
  '#432429'
]

const graphite: MantineColorsTuple = [
  '#f4f4f6',
  '#e8e9ec',
  '#d9dbe0',
  '#c6c8cf',
  '#a7aab4',
  '#747985',
  '#454852',
  '#383b44',
  '#2e3139',
  '#26282e'
]

const slate: MantineColorsTuple = [
  '#f0f1f3',
  '#d6d8dc',
  '#acb0b7',
  '#898e97',
  '#686d76',
  '#50545c',
  '#3b3e44',
  '#2c2e31',
  '#252628',
  '#171819'
]

export const appTheme = createTheme({
  primaryColor: 'blue',
  primaryShade: { light: 6, dark: 3 },
  colors: {
    blue,
    graphite,
    gray: graphite,
    dark: slate,
    green,
    teal: green,
    yellow: amber,
    orange: amber,
    red
  },
  autoContrast: true,
  variantColorResolver: (input) => {
    const resolved = defaultVariantColorsResolver(input)
    const color = input.color || input.theme.primaryColor
    // A white cover label keeps a dark foreground even when the app uses pale dark-mode accents.
    if (input.variant === 'white' && input.theme.colors[color]) {
      return { ...resolved, color: input.theme.colors[color][6] }
    }
    // Unshaded fills change with the scheme. Resolve their text in both schemes too.
    if (
      input.variant === 'filled' &&
      input.theme.colors[color] &&
      (input.autoContrast ?? input.theme.autoContrast)
    ) {
      return {
        ...resolved,
        color: `light-dark(${getContrastColor({ ...input, colorScheme: 'light' })}, ${getContrastColor({ ...input, colorScheme: 'dark' })})`
      }
    }
    const semantic =
      color === 'blue'
        ? 'accent'
        : color === 'green' || color === 'teal'
          ? 'success'
          : color === 'yellow' || color === 'orange'
            ? 'warning'
            : color === 'red'
              ? 'danger'
              : null
    if (input.variant === 'light' && semantic) {
      return {
        ...resolved,
        background: `var(--omni-${semantic}-soft)`,
        hover: `var(--omni-${semantic}-soft)`,
        color: `var(--omni-${semantic}-ink)`
      }
    }
    return resolved
  },
  defaultRadius: 'sm',
  radius: { xs: '4px', sm: '7px', md: '10px', lg: '14px', xl: '18px' },
  spacing: { xs: '6px', sm: '10px', md: '16px', lg: '24px', xl: '32px' },
  fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif',
  fontFamilyMonospace: '"Cascadia Code", "Consolas", monospace',
  fontSizes: { xs: '12px', sm: '13px', md: '14px', lg: '16px', xl: '20px' },
  headings: {
    fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif',
    fontWeight: '650',
    sizes: {
      h1: { fontSize: '24px', lineHeight: '1.25' },
      h2: { fontSize: '19px', lineHeight: '1.3' },
      h3: { fontSize: '15px', lineHeight: '1.35' }
    }
  },
  components: {
    SegmentedControl: SegmentedControl.extend({
      defaultProps: { withItemsBorders: false },
      classNames: { root: 'omni-segmented-control' }
    }),
    Button: Button.extend({
      defaultProps: { size: 'sm', radius: 'sm' },
      vars: (_theme, props) => ({
        root:
          (props.variant ?? 'filled') === 'filled' && (!props.color || props.color === 'blue')
            ? {
                '--button-bg': 'var(--omni-action-fill)',
                '--button-hover': 'var(--omni-action-hover)',
                '--button-color': 'var(--omni-action-ink)',
                '--button-bd': '1px solid transparent'
              }
            : props.variant === 'light' && !props.color
              ? {
                  '--button-bg': 'var(--omni-surface-soft)',
                  '--button-hover': 'var(--omni-nav-selected)',
                  '--button-color': 'var(--omni-ink)',
                  '--button-bd': '1px solid transparent'
                }
              : {}
      })
    }),
    Tabs: Tabs.extend({
      vars: (_theme, props) => ({
        root: !props.color
          ? {
              '--tabs-color':
                props.variant === 'pills' ? 'var(--omni-nav-selected)' : 'var(--omni-nav-ink)',
              '--tabs-text-color': 'var(--omni-nav-ink)'
            }
          : {}
      })
    }),
    Checkbox: Checkbox.extend({
      vars: (_theme, props) => ({
        root:
          (!props.color || props.color === 'blue') && (props.variant ?? 'filled') === 'filled'
            ? {
                '--checkbox-color': 'var(--omni-action-fill)',
                '--checkbox-icon-color': props.iconColor ? undefined : 'var(--omni-action-ink)'
              }
            : {}
      })
    }),
    Radio: Radio.extend({
      vars: (_theme, props) => ({
        root:
          (!props.color || props.color === 'blue') && (props.variant ?? 'filled') === 'filled'
            ? {
                '--radio-color': 'var(--omni-action-fill)',
                '--radio-icon-color': props.iconColor ? undefined : 'var(--omni-action-ink)'
              }
            : {}
      })
    }),
    Switch: Switch.extend({
      vars: (_theme, props) => ({
        root:
          !props.color || props.color === 'blue'
            ? { '--switch-color': 'var(--omni-action-fill)' }
            : {}
      })
    }),
    ActionIcon: { defaultProps: { size: 'sm', radius: 'sm' } },
    TextInput: { defaultProps: { size: 'sm', radius: 'sm' } },
    NumberInput: { defaultProps: { size: 'sm', radius: 'sm' } },
    Select: { defaultProps: { size: 'sm', radius: 'sm' } },
    Textarea: { defaultProps: { size: 'sm', radius: 'sm' } },
    Modal: { defaultProps: { centered: true, radius: 'lg' } },
    Paper: { defaultProps: { radius: 'lg' } }
  }
})
