import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import importPlugin from 'eslint-plugin-import-x'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'

export default defineConfigWithVueTs(
  { ignores: ['dist/**', 'node_modules/**', 'components.d.ts'] },
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  {
    plugins: { 'import-x': importPlugin },
    languageOptions: {
      parserOptions: { parser: '@typescript-eslint/parser' }
    },
    settings: {
      'import-x/extensions': ['.js', '.mjs', '.ts', '.tsx', '.vue'],
      'import-x/parsers': {
        '@typescript-eslint/parser': ['.ts', '.tsx'],
        'vue-eslint-parser': ['.vue']
      },
      'import-x/resolver-next': [createTypeScriptImportResolver({ project: './tsconfig.json' })]
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'vue/no-restricted-syntax': [
        'error',
        {
          selector: 'TSAnyKeyword',
          message: 'Use the actual value or event type in template expressions.'
        },
        {
          selector: 'TSNonNullExpression',
          message: 'Narrow the value before using it in a template.'
        }
      ],
      'import-x/no-cycle': ['error', { ignoreExternal: true }]
    }
  },
  {
    files: ['src/shared/**/*.{ts,tsx,vue,mjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
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
    files: ['src/features/**/*.{ts,tsx,vue,mjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/app/**', '**/app/**'],
              message:
                'Features expose behavior to the application; they must not import application composition.'
            }
          ]
        }
      ]
    }
  }
)
