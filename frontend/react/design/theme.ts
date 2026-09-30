import { createTheme, type MantineColorsTuple } from '@mantine/core'

const ocean: MantineColorsTuple = [
  '#e9f3ff',
  '#d8eaff',
  '#b5d7ff',
  '#8fc2fa',
  '#6bacee',
  '#428ed9',
  '#2673bd',
  '#1d5f9d',
  '#1c4f80',
  '#1b4268'
]

const slate: MantineColorsTuple = [
  '#edf3f8',
  '#d4e0e9',
  '#b8cbd8',
  '#92aabb',
  '#6e899d',
  '#4b667b',
  '#2a4051',
  '#202f3d',
  '#192633',
  '#121b25'
]

export const appTheme = createTheme({
  primaryColor: 'ocean',
  colors: { ocean, dark: slate },
  autoContrast: true,
  defaultRadius: 'md',
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
    Button: { defaultProps: { size: 'sm', radius: 'sm' } },
    ActionIcon: { defaultProps: { size: 'sm', radius: 'sm' } },
    TextInput: { defaultProps: { size: 'sm', radius: 'sm' } },
    NumberInput: { defaultProps: { size: 'sm', radius: 'sm' } },
    Select: { defaultProps: { size: 'sm', radius: 'sm' } },
    Textarea: { defaultProps: { size: 'sm', radius: 'sm' } },
    Modal: { defaultProps: { centered: true, radius: 'lg' } },
    Paper: { defaultProps: { radius: 'lg' } }
  }
})
