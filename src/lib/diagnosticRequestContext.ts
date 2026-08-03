/**
 * Client-safe diagnostic request context accessors.
 * Server binds AsyncLocalStorage via diagnosticRequestContext.server.ts (route boot).
 */

export type DiagnosticRequestContext = {
  bypassParagraphNormalize?: boolean;
  bypassDisplayParagraphGrouping?: boolean;
};

type DiagnosticStoreGetter = () => DiagnosticRequestContext | undefined;

const GLOBAL_KEY = "__rpDiagnosticRequestContextGet" as const;

function serverStoreGetter(): DiagnosticStoreGetter | undefined {
  if (typeof window !== "undefined") return undefined;
  const g = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: DiagnosticStoreGetter;
  };
  return g[GLOBAL_KEY];
}

export function bindDiagnosticRequestContextGetter(getter: DiagnosticStoreGetter): void {
  if (typeof window !== "undefined") return;
  const g = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: DiagnosticStoreGetter;
  };
  g[GLOBAL_KEY] = getter;
}

export function getDiagnosticRequestContext(): DiagnosticRequestContext | undefined {
  return serverStoreGetter()?.();
}

export function isDiagnosticParagraphNormalizeBypassed(): boolean {
  return Boolean(getDiagnosticRequestContext()?.bypassParagraphNormalize);
}

export function isDiagnosticDisplayParagraphGroupingBypassed(): boolean {
  return Boolean(getDiagnosticRequestContext()?.bypassDisplayParagraphGrouping);
}
