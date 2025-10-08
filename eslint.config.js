import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: globals.node
    }
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
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
    files: ["tests/**/*.ts"],
    rules: {
      // Allow console in tests
      "no-console": "off",
      // Allow any in tests for mocking
      "@typescript-eslint/no-explicit-any": "off",
      // Allow unused vars in tests (like expect parameters)
      "@typescript-eslint/no-unused-vars": "off"
    }
  },
  {
    ignores: [
      "dist/**/*",
      "node_modules/**/*",
      "coverage/**/*",
      "*.js"
    ]
  }
];