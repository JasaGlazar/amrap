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
  { ignores: ['dist', 'dev-dist', 'coverage', 'src/lib/database.types.ts'] },
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
    files: ['scripts/**/*.mjs', 'vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
);
