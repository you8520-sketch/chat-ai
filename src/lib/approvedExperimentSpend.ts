import { createHash } from "node:crypto";

/**
 * Request-level classification of remote CheaperInference usage.
 * Reused by the existing forward-recon owner. Not a second ledger,
 * price calculator, or billing writer.
 *
 * Confirmed experiment identities are SHA-256 hex of provider request_id.
 * A key name or prefix never confirms spend. Raw request IDs, API keys,
 * and key UUIDs are not stored here.
 */

export type ForwardSpendClass =
  | "PRODUCTION_LEDGER_MATCHED"
  | "APPROVED_EXPERIMENT_CONFIRMED"
  | "UNKNOWN_UNMATCHED"
  | "UNVERIFIABLE";

/** Public #1461 / #1468 Gemini CI request IDs, matched on usage:read. */
const GEMINI_1461_REQUEST_ID_HASHES = [
  "fb9db06a58afc23eb5d3199bf68399b9b5a8a77494f2eddf6a1965e3be896214",
  "d1c9f0109b5f2e6c5f909926c61e60bd4ab374c9cee67c9f0fe02ef530cb7001",
  "36aeac27dbd5753a407ed03d6b5fc773862f99798d7604e867861c4b2854d241",
  "4a874c45a70d3d20c5145990cfa702391c203fc2e404081f99d64656c4bfba45",
  "5aec2d9baf23307c228438e2e0e5c350943c435369d09899d5d0545332cf3500",
  "92572ccd874f988fd3921a69b09a3d3ab3521d958a55148bdca22e4662f6206a",
  "8285dee1c19881088dbae1a24562abb6a28fa7ec3d540d1696ec306b581cc9de",
] as const;

const GEMINI_1468_REQUEST_ID_HASHES = [
  "59bc67d07fce37d3545efd0cb12ebf53004e86a95ff742a6f45fde2e1a8487f2",
  "f9aebe33e3ff65b4b96aa3446e3cc681656bd14fc2531c0ed4063270f4b9c0ae",
  "fe3b6f97d96438f14acd5e8301e0dbc23ea989f612213936e3542f3f7d3c557a",
  "f632473b78a6c7c472775c2abd3ec2fb2d535f2330201429919ea628931655d8",
  "45f3c86cf70dc7ae244375806b01011f2ebe7254b485b818ea8087a0771e179f",
  "44e9f6d75259a9198f4f34f8083e90f009beddd5979efc8f378478e7c2496f84",
] as const;

/**
 * #1425 official-author Luna lines. Each hash is one remote request_id
 * whose billed micro-USD and UTC instant matched an authorized cost.json
 * line on the non-production key that also served the confirmed Gemini
 * experiment IDs. Not an aggregate or name match.
 */
const LUNA_1425_REQUEST_ID_HASHES = [
  "b2a05bcb413ab6c67d3e61ffbbae65c94d0bad1273c4f002d65f602951866611",
  "68dc65631b5b2191e7db7477f34a29af573fb48eaf84007df40b92e8170492eb",
  "1c6baac8f47207453fe320724b2c48ba66bccc85984023df2514fb622aa01a83",
  "79ff8090ba841ffe8c45c24344f5b5a6220735ada153d9c70a170c1c3cf5d6a2",
  "e6339430ced6f153d548db93fa93b8fef7c2a6e841a5e3bc8c243be870f91c15",
  "45f808ce87676d8f7840de911dcb6be6014769457c6706b96136317a7011478b",
] as const;

/** #1354 body-cue Flash requests, including published CALL1 hash 641b94a0…04cb. */
const DEEPSEEK_1354_REQUEST_ID_HASHES = [
  "641b94a0da1bda759d2c911b90f3611bf906b574ddbcfca7f48a30903b2b04cb",
  "a17314edab2297b828f2edbfa78a3a6d8ee7c09fbcbd5e96a5570d50dc8a4050",
  "30dd5b18f22c581b48bea57f0c5863525abd935314aa851cf85ed2a9c76c805f",
  "5d4a985d8d92b847757dcc2dbd9975696c18086fddfc6d469d28bbf81d3627a5",
  "3a7254a801b1d8dd5cb221f19b518b0a0acc45f3c4de8f6152031531baf36f91",
  "c5bf491dd7b35d8c26ec3afa6ff8ebf2029b780d2825783861e1ce72cd17be5a",
] as const;

export const CONFIRMED_APPROVED_EXPERIMENT_REQUEST_ID_HASHES: ReadonlySet<string> = new Set([
  ...GEMINI_1461_REQUEST_ID_HASHES,
  ...GEMINI_1468_REQUEST_ID_HASHES,
  ...LUNA_1425_REQUEST_ID_HASHES,
  ...DEEPSEEK_1354_REQUEST_ID_HASHES,
]);

export type ApprovedExperimentEvidence = {
  confirmedRequestIdHashes?: ReadonlySet<string>;
};

export function hashProviderRequestId(requestId: string): string {
  return createHash("sha256").update(requestId.trim()).digest("hex");
}

export function unknownRequestFingerprint(requestIds: readonly string[]): string | null {
  const hashes = requestIds
    .map((id) => id.trim())
    .filter(Boolean)
    .map(hashProviderRequestId)
    .sort();
  if (hashes.length === 0) return null;
  return hashProviderRequestId(hashes.join(",")).slice(0, 16);
}

export function classifyForwardSettledSpend(input: {
  requestId: string;
  ledgerIds: ReadonlySet<string>;
  evidence?: ApprovedExperimentEvidence;
}): ForwardSpendClass {
  const requestId = input.requestId.trim();
  if (!requestId) return "UNVERIFIABLE";
  if (input.ledgerIds.has(requestId)) return "PRODUCTION_LEDGER_MATCHED";

  const hashes = input.evidence?.confirmedRequestIdHashes ?? CONFIRMED_APPROVED_EXPERIMENT_REQUEST_ID_HASHES;
  if (hashes.has(hashProviderRequestId(requestId))) {
    return "APPROVED_EXPERIMENT_CONFIRMED";
  }

  return "UNKNOWN_UNMATCHED";
}
