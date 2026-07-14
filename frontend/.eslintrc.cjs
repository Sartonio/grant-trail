/**
 * ESLint config for the frontend.
 *
 * Architecture boundaries are GENERATED from ./module-map.json — that file is
 * the single source of truth for module areas and their allowedImports.
 * To change what an area may import, edit module-map.json, NOT this file.
 * (The eslint-plugin-boundaries element types + rule matrix below are derived
 * from it programmatically.)
 */
const map = require('./module-map.json');
const modules = map.modules;
const areas = Object.keys(modules); // specific-first order (see module-map.json)

// eslint-plugin-boundaries element types, generated from the map.
const boundaryElements = areas.map((type) => ({
  type,
  pattern: modules[type].pattern,
  mode: modules[type].mode || 'full',
}));

// element-types rule matrix, generated from each area's allowedImports.
// An area may always import within itself; cross-area edges come from the map.
const boundaryRules = areas.map((type) => ({
  from: [type],
  allow: [type, ...modules[type].allowedImports],
}));

// Components allowed to import the Supabase client directly (grep'd 2026-07-14).
// SHRINK-ONLY: remove entries as they migrate to lib/data, NEVER add. New
// components must go through frontend/src/lib/data/<entity>.js.
const supabaseClientAllowedFiles = [
  'src/components/auth/CompleteProfile.js',
  'src/components/auth/Login.js',
  'src/components/auth/Login.test.js',
  'src/components/auth/ResetPassword.js',
  'src/components/auth/SignUpClean.js',
  'src/components/auth/SignUpClean.test.js',
  'src/components/grant/AddExpenseModal.js',
  'src/components/grant/GrantAttachments.js',
];

module.exports = {
  env: {
    browser: true,
    es2020: true,
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['react', 'react-hooks', 'boundaries'],
  settings: {
    'boundaries/elements': boundaryElements,
    'boundaries/ignore': [
      '**/*.css',
      'src/index.js',
      'src/App.js',
      'src/setupTests.js',
      'src/types/**',
      'src/styles/**',
      'src/lib/database.types.ts',
      'src/assets/**',
    ],
  },
  rules: {
    'boundaries/element-types': [
      'error',
      {
        default: 'disallow',
        rules: boundaryRules,
      },
    ],
  },
  overrides: [
    {
      files: ['src/components/**/*.js'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "CallExpression[callee.object.name='supabase'][callee.property.name='from']",
            message:
              'Components must not call supabase.from(...) directly — add or reuse a function in frontend/src/lib/data/<entity>.js instead.',
          },
        ],
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/supabaseClient'],
                message:
                  'Components must not import the Supabase client directly — go through frontend/src/lib/data/<entity>.js instead.',
              },
            ],
          },
        ],
      },
    },
    {
      // SHRINK-ONLY allowlist: the components that still import supabaseClient
      // directly. Remove a file here as it migrates; never add one.
      files: supabaseClientAllowedFiles,
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
};
