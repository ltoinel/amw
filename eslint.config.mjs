import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    // An object holding only `ignores` is global: these paths are skipped whatever is passed on the command line
    ignores: [
      "dist/**",
      "coverage/**",
      "**/node_modules/**",
      "site/**",
      ".venv/**",
      "test-results/**",
      "playwright-report/**",
      ".claude/**"
    ]
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,vue}"],
    languageOptions: {
      globals: globals.node
    }
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/essential"],
  {
    rules: {
      // TypeScript specific rules
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-require-imports": "off",

      // General JavaScript/TypeScript rules
      "no-console": "warn",
      "no-debugger": "error",
      "prefer-const": "error",
      "no-var": "error",
      "eqeqeq": ["error", "always"],
      "curly": "off", // Too strict for this codebase
      "no-prototype-builtins": "off",

      // Code style - made more flexible
      "indent": "off", // Current codebase uses mixed indentation
      "quotes": "off", // Mixed quotes in current codebase
      "semi": "off", // Mixed semicolon usage
      "comma-trailing": "off",
      "object-curly-spacing": "off",
      "array-bracket-spacing": "off",

      // Node.js specific
      "no-process-exit": "error",
      "no-sync": "warn"
    }
  },
  {
    files: ["tests/**/*.ts", "admin/tests/**/*.ts"],
    rules: {
      // Allow console in tests
      "no-console": "off",
      // Allow any in tests for mocking
      "@typescript-eslint/no-explicit-any": "off",
      // Allow unused vars in tests (like expect parameters)
      "@typescript-eslint/no-unused-vars": "off",
      // Fixtures and build outputs are read synchronously while the suite is set up
      "no-sync": "off"
    }
  },
  {
    // One-shot command-line tools: blocking I/O, console output and exit codes are their interface
    files: ["scripts/**/*.{js,ts}"],
    rules: {
      "no-console": "off",
      "no-process-exit": "off",
      "no-sync": "off"
    }
  },
  {
    // Classic scripts loaded by a <script> tag on third-party pages and on the documentation site
    files: ["src/widgets/**/*.js", "docs/javascripts/**/*.js"],
    languageOptions: {
      sourceType: "script",
      // document$ is the navigation observable Material for MkDocs exposes to extra scripts
      globals: { ...globals.browser, document$: "readonly" }
    },
    rules: {
      // The console of the host page is the only place the widget can report a problem
      "no-console": "off",
      // Kept as `catch (e)`: the binding is left unused where a failure is deliberately ignored
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "caughtErrors": "none" }]
    }
  },
  {
    files: ["admin/src/**/*.{ts,vue}", "admin/tests/**/*.ts"],
    languageOptions: {
      globals: globals.browser,
      // vue-eslint-parser handles the template and hands <script lang="ts"> to this one
      parserOptions: { parser: tseslint.parser }
    }
  }
];
