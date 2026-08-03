import "server-only";

import { AsyncLocalStorage } from "async_hooks";
import {
  bindDiagnosticRequestContextGetter,
  type DiagnosticRequestContext,
} from "@/lib/diagnosticRequestContext";

const storage = new AsyncLocalStorage<DiagnosticRequestContext>();

bindDiagnosticRequestContextGetter(() => storage.getStore());

export function runWithDiagnosticContext<T>(
  ctx: DiagnosticRequestContext,
  fn: () => T
): T {
  return storage.run(ctx, fn);
}

export type { DiagnosticRequestContext };
