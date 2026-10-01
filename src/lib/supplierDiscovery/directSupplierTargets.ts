/**
 * Canonical id list for the existing direct-supplier public-page radar.
 * Parsers and URL shapes stay in scripts/lib/mainRpDirectSupplierRadar.ts.
 * Independent suppliers that do not have those per-model pages do not belong here.
 */
export const DIRECT_SUPPLIER_PUBLIC_RADAR_IDS = ["onemux", "aireiter", "dit"] as const;

export type DirectSupplierId = (typeof DIRECT_SUPPLIER_PUBLIC_RADAR_IDS)[number];
