"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { JsxHostBridge } from "@/components/JsxComponentSandbox";
import type { JsxRuntimeComponentRecord } from "@/lib/jsxComponent/types";

const BridgeCtx = createContext<JsxHostBridge | null>(null);
const CatalogCtx = createContext<JsxRuntimeComponentRecord[]>([]);

export function JsxHostBridgeProvider({
  value,
  catalog,
  children,
}: {
  value: JsxHostBridge | null;
  catalog?: JsxRuntimeComponentRecord[];
  children: ReactNode;
}) {
  const records = useMemo(() => catalog ?? [], [catalog]);
  return (
    <BridgeCtx.Provider value={value}>
      <CatalogCtx.Provider value={records}>{children}</CatalogCtx.Provider>
    </BridgeCtx.Provider>
  );
}

export function useJsxHostBridge(): JsxHostBridge | null {
  return useContext(BridgeCtx);
}

export function useJsxComponentCatalog(): JsxRuntimeComponentRecord[] {
  return useContext(CatalogCtx);
}
