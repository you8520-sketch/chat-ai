import { transform } from "sucrase";
import { analyzeJsxCapabilities, sourceLooksNetworked } from "./capabilities";
import { JSX_COMPILED_MAX_CHARS, JSX_SOURCE_MAX_CHARS } from "./limits";
import type { JsxCompileResult } from "./types";

const FORBIDDEN = [
  /\bimport\s+/,
  /\brequire\s*\(/,
  /\beval\s*\(/,
  /\bnew\s+Function\b/,
  /\bimportScripts\s*\(/,
];

export function compileJsxComponentSource(source: string, componentName?: string): JsxCompileResult {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, error: "컴포넌트 소스가 비어 있습니다." };
  if (trimmed.length > JSX_SOURCE_MAX_CHARS) {
    return { ok: false, error: "컴포넌트 소스가 너무 큽니다." };
  }
  if (sourceLooksNetworked(trimmed)) {
    return { ok: false, error: "external network API는 v1에서 허용되지 않습니다." };
  }
  for (const rule of FORBIDDEN) {
    if (rule.test(trimmed)) {
      return { ok: false, error: "import/require/eval 은 사용할 수 없습니다." };
    }
  }

  let js: string;
  try {
    js = transform(trimmed, {
      transforms: ["typescript", "jsx", "imports"],
      jsxRuntime: "classic",
      production: true,
    }).code;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "JSX compile failed",
    };
  }

  const fallbackName =
    componentName && /^[A-Z][A-Za-z0-9]*$/.test(componentName) ? componentName : "";
  const fallbackResolve = fallbackName
    ? `if (typeof __comp !== "function" && typeof ${fallbackName} === "function") __comp = ${fallbackName};`
    : "";
  const wrapped = `"use strict";
var exports = {};
var module = { exports: exports };
${js}
var __comp = module.exports && module.exports.default
  ? module.exports.default
  : module.exports;
${fallbackResolve}
if (typeof __comp !== "function") {
  throw new Error("JSX component must export a function component or define the named component");
}
return __comp;`;

  if (wrapped.length > JSX_COMPILED_MAX_CHARS) {
    return { ok: false, error: "compiled component가 너무 큽니다." };
  }

  const capabilities = analyzeJsxCapabilities(trimmed);
  return {
    ok: true,
    compiled: wrapped,
    capabilities,
    chatSend: capabilities.includes("chat_send"),
  };
}
