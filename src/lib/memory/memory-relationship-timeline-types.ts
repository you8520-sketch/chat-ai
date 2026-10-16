/** Client-safe shapes of the ledger timeline (no server imports). */

export type RelationshipLedgerEventCategory = "promise" | "item";
/** `released` = the ledger stopped holding it (cancelled, fulfilled or expired). */
export type RelationshipLedgerEventChange = "created" | "released" | "changed";
export type RelationshipLedgerEventValidity =
  | "active"
  | "ended"
  | "superseded"
  | "absent";

export type RelationshipLedgerEvent = {
  id: string;
  category: RelationshipLedgerEventCategory;
  change: RelationshipLedgerEventChange;
  key: string;
  label: string;
  previousLabel: string | null;
  turn: number;
  assistantMessageId: number;
  userMessageId: number | null;
  validity: RelationshipLedgerEventValidity;
};
