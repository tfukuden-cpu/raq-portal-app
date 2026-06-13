import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // React Compiler系（react-hooks v6）の新ルールは誤検出が多く既存コードに大量ヒットするため
  // error → warn に降格（可視化は維持しつつビルド/レビューのノイズを減らす）。
  // 本当に害のある個別ケースは見つけ次第コードを直す方針。
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/static-components": "warn",
      // 除外目的の分割代入（...rest と一緒に書く兄弟）や、意図的に未使用な _ 始まりは許可
      "@typescript-eslint/no-unused-vars": ["warn", {
        ignoreRestSiblings: true,
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
