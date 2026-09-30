import { createTheme, type MantineColorsTuple } from '@mantine/core'

const ocean: MantineColorsTuple = [
  '#f0f4fb',
  '#e2eaf7',
  '#c6d5ee',
  '#a6bfe2',
  '#84a3d0',
  '#6287c0',
  '#466daf',
  '#365b98',
  '#2e4c7e',
  '#293f63'
]

const slate: MantineColorsTuple = [
  '#f2f2f1',
  '#d7d8da',
  '#b9bbbf',
  '#999ca2',
  '#767980',
  '#56585e',
  '#38393e',
  '#292a2d',
  '#1c1d1f',
  '#171819'
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
