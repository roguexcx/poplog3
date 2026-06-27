import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "**/.next/**",
    ".claude/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/refs": "off",
      "@typescript-eslint/no-explicit-any": "off",
      // Imagens externas são servidas via /api/images/proxy e o Next está em
      // images.unoptimized=true (ver next.config.ts): <img> é a escolha
      // arquitetural intencional. next/image não otimizaria nada aqui e exigiria
      // allowlist de domínios. Por isso a regra fica desligada de forma documentada.
      "@next/next/no-img-element": "off",
      // Variáveis e parâmetros prefixados com _ são intencionalmente não-usados
      // (stubs, interfaces de adapter, parâmetros de posição em destructuring).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
]);

export default eslintConfig;
