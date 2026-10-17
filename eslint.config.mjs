import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "no-empty": "warn",
      "no-useless-assignment": "off",
      "no-useless-escape": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "node_modules/**",
    "next-env.d.ts",
    // 生成物：维护者 CLI 由 scripts/build-cloud-publish.mjs 用 esbuild 打包而来。
    "scripts/.build/**",
  ]),
]);
