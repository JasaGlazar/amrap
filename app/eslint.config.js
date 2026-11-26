import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// User-visible text lives in src/i18n/sl.ts. These selectors flag literal text in JSX and in
// accessibility/label attributes so a hardcoded string cannot slip into a component.
const noHardcodedUiStrings = [
  'error',
  {
    selector: 'JSXText[value=/\\S/]',
    message: 'Hardcoded UI text. Add the string to src/i18n/sl.ts and use t.',
  },
  {
    selector: 'JSXAttribute[name.name=/^(aria-label|title|placeholder|alt)$/] > Literal',
    message: 'Hardcoded UI text. Add the string to src/i18n/sl.ts and use t.',
  },
];

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-e2e',
      'dev-dist',
      'coverage',
      'src/lib/database.types.ts',
      'deploy/.cloudflare',
      'deploy/.wrangler',
      'playwright-report',
      'test-results',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/**/*.test.tsx'],
    rules: { 'no-restricted-syntax': noHardcodedUiStrings },
  },
  {
    files: ['vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['e2e/**/*.spec.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='browser'][callee.property.name=/^(newContext|newPage)$/]",
          message:
            'Use newGuardedPage() from the fixtures; it blocks requests outside the local stack.',
        },
      ],
    },
  },
  {
    // Playwright fixtures take `use` and `{}` by design; neither is React.
    files: ['e2e/fixtures.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'no-empty-pattern': 'off',
    },
  },
);
