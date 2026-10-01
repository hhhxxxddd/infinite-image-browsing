import { defineConfig } from 'eslint/config'
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import importPlugin from 'eslint-plugin-import-x'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'

const retiredUiImports = [
  'vue',
  'vue/*',
  '@vue/*',
  '@vueuse/*',
  'pinia',
  'pinia/*',
  'ant-design-vue',
  '*.vue'
]

export default defineConfig(
  { ignores: ['dist/**', 'node_modules/**', 'src-tauri/**'] },
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' }
    },
    plugins: { '@typescript-eslint': tsPlugin, 'import-x': importPlugin },
    settings: {
      'import-x/extensions': ['.js', '.mjs', '.ts', '.tsx'],
      'import-x/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
      'import-x/resolver-next': [createTypeScriptImportResolver({ project: './tsconfig.json' })]
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'import-x/no-cycle': ['error', { ignoreExternal: true }],
      'no-restricted-imports': [
        'error',
        {
          patterns: retiredUiImports
        }
      ]
    }
  },
  {
    files: ['src/shared/**/*.{ts,mjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: retiredUiImports },
            {
              group: ['@/app/**', '@/features/**', '**/app/**', '**/features/**'],
              message:
                'Shared code must not depend on application composition or business features.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/features/**/*.{ts,mjs}', 'react/features/**/*.{ts,tsx,mjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: retiredUiImports },
            {
              group: ['@/app/**', '**/app/**'],
              message: 'Features must not import application composition.'
            }
          ]
        }
      ]
    }
  }
)
