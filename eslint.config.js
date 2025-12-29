import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // ============================================
  // IGNORES (înlocuiește .eslintignore)
  // ============================================
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.next/**',
      'coverage/**',
      '*.min.js',
      'Research Produse/**',
      'Research Categorii/**',
      'pnpm-lock.yaml',
    ],
  },

  // ============================================
  // BASE CONFIG (toate fișierele)
  // ============================================
  js.configs.recommended,

  // ============================================
  // TYPESCRIPT CONFIG
  // ============================================
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // ============================================
  // PROJECT SETTINGS
  // ============================================
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ============================================
      // TYPESCRIPT RULES
      // ============================================
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      // Drizzle ORM FK references use arrow functions that return table.id
      // This triggers false positives for no-unsafe-return/member-access
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',

      // ============================================
      // GENERAL RULES
      // ============================================
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'all'],
    },
  },

  // ============================================
  // PRETTIER (dezactivează reguli conflictuale) - TREBUIE ULTIMUL
  // ============================================
  prettier,

  // ============================================
  // CONFIG FILES (no type checking)
  // ============================================
  {
    files: ['*.config.js', '*.config.ts', '*.config.mjs', '**/drizzle.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  }
);
