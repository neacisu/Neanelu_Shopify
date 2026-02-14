import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsconfigPath = join(__dirname, 'tsconfig.eslint.json');
const webAdminTsconfigPath = join(__dirname, 'apps/web-admin/tsconfig.json');

export default tseslint.config(
  // ============================================
  // IGNORES (înlocuiește .eslintignore)
  // ============================================
  {
    ignores: [
      'node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/src/**/*.js',
      '**/src/**/*.js.map',
      '**/src/**/*.d.ts',
      '**/src/**/*.d.ts.map',
      '*.min.js',
      'Research Produse/**',
      'Research Categorii/**',
      'Research Metafileds/**',
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
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: {
        project: [tsconfigPath],
        tsconfigRootDir: __dirname,
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
      // Temporary compatibility guard for ESLint 10 + typescript-eslint 8.x
      '@typescript-eslint/consistent-generic-constructors': 'off',
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
  // FRONTEND (apps/web-admin) - use browser tsconfig
  // ============================================
  {
    files: ['apps/web-admin/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: [webAdminTsconfigPath],
        tsconfigRootDir: __dirname,
      },
    },
  },

  // ============================================
  // FRONTEND TESTS (apps/web-admin) - relax unsafe rules for mocks
  // ============================================
  {
    files: [
      'apps/web-admin/**/*.{test,spec}.{ts,tsx}',
      'apps/web-admin/**/__tests__/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },

  // ============================================
  // PRETTIER (dezactivează reguli conflictuale) - TREBUIE ULTIMUL
  // ============================================
  prettier,

  // ============================================
  // SCRIPTS (JS) - no type checking
  // ============================================
  {
    files: ['scripts/**/*.js', 'packages/**/scripts/**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        // Node globals used in workspace scripts
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
  },

  // ============================================
  // CONFIG FILES (no type checking)
  // ============================================
  {
    files: ['**/*.config.js', '**/*.config.ts', '**/*.config.mjs', '**/drizzle.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  }
);
