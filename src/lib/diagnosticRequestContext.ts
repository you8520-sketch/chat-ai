import { AsyncLocalStorage } from "async_hooks";

export type DiagnosticRequestContext = {
  bypassParagraphNormalize?: boolean;
  bypassDisplayParagraphGrouping?: boolean;
};

const storage = new AsyncLocalStorage<DiagnosticRequestContext>();

export function runWithDiagnosticContext<T>(
  ctx: DiagnosticRequestContext,
  fn: () => T
): T {
  return storage.run(ctx, fn);
}

export function getDiagnosticRequestContext(): DiagnosticRequestContext | undefined {
  return storage.getStore();
}

export function isDiagnosticParagraphNormalizeBypassed(): boolean {
  return Boolean(getDiagnosticRequestContext()?.bypassParagraphNormalize);
}

export function isDiagnosticDisplayParagraphGroupingBypassed(): boolean {
  return Boolean(getDiagnosticRequestContext()?.bypassDisplayParagraphGrouping);
}
