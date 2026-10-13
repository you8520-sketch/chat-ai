/**
 * Public #1466 preapproval fingerprints (plus the #1587 successor baseline
 * below) only. No request bodies, no secrets.
 * Live deployed reseal must rematch identity / body / wire / provider / canon /
 * uncapped fields. Manifest fingerprint rotation after a deploy SHA change is
 * expected and is not body drift.
 */
import {
  PAID_RUNNER_A_RELATIONSHIP_EMOTION_SCOPE,
  type PaidRunnerExecutionScope,
  type PaidRunnerIdentityHashes,
  type PaidRunnerPublicManifest,
} from "@/lib/rpQualityPaidRunner";

export const PUBLISHED_1466_PRODUCTION_SHA =
  "88d277f868c4a445e8dd7d24ea50f322fff1483d" as const;
export const PUBLISHED_1466_IDENTITY_HASH =
  "5f400d361ffd7eba0747cada89726d43ee38a36677768beac048c8732af02ded" as const;
export const PUBLISHED_1466_MANIFEST_FINGERPRINT =
  "a600358fcc7bc6772945f62a36bb7d7c2c57b2b7eeb2191e822d816353f01b1e" as const;

export const PUBLISHED_1466_IDENTITY_HASHES: PaidRunnerIdentityHashes = {
  greetingSha256: "29e3149289586f303c3ffc120a299184163b162a78e46e4f264e87231f6d1d58",
  systemPromptSha256: "44c293ce3e6aaa7ab885ad93c93342a0e4d1ed803a2c7e22119f42991ee44d6b",
  worldSha256: "6e197c4e91f3f5dbe9a3b867232c564230272fe6a29e24f26d2f41964a500fa9",
  settingChunksSha256: "8eee31d5ce8cd6a736030613ac615a3755542a718d22f082a02c4d9ba0aa90cc",
  personaPublicSha256: "9ef42c7f92091ca158a53c4321b06dab4e687d3a882210c4a576e87029703a36",
};

export const PUBLISHED_1466_CALLS = [
  {
    requestOrder: 1,
    fixtureId: "A_relationship_emotion",
    canonicalId: "deepseek-v4.1-flash",
    provider: "cheaperinference",
    wireModel: "deepseek-v4.1-flash",
    effectiveCanonMode: "LAYERED",
    requestBodyFingerprint: "abc20b50d25306c9e61b99b105caadc0a67fea719642c0c3582fb6b97fc0f702",
    finalWireFingerprint: "d86943df3ad8a6b4e6fa224d4f5ffb75a6247a61a415ad47f3ec793c3f8bceef",
    maxTokensPresent: false,
  },
  {
    requestOrder: 2,
    fixtureId: "A_relationship_emotion",
    canonicalId: "gemini-3.8-flash",
    provider: "openrouter",
    wireModel: "google/gemini-3.8-flash",
    effectiveCanonMode: "FULL_LEGACY",
    requestBodyFingerprint: "c9748fb3457f730b622662c59ede103f96ab12140dc4f8b9289af93f8e64c57f",
    finalWireFingerprint: "ff5256394f6b05510084bdf91729a88eb062988a5065c3c2b67b4cf9e8b3c559",
    maxTokensPresent: false,
  },
  {
    requestOrder: 3,
    fixtureId: "A_relationship_emotion",
    canonicalId: "gpt-6.1-sol",
    provider: "cheaperinference",
    wireModel: "gpt-6.1-sol",
    effectiveCanonMode: "FULL_LEGACY",
    requestBodyFingerprint: "f02880f68985fec7252945db49a3c22118f9e6237bcb86f8b82afd449b9b0a4a",
    finalWireFingerprint: "87645438c97f2e9c4b082e3a63c10b4ae2bf7879f292e15f5f2152927af20b4f",
    maxTokensPresent: false,
  },
  {
    requestOrder: 4,
    fixtureId: "A_relationship_emotion",
    canonicalId: "claude-opus-5.5",
    provider: "cheaperinference",
    wireModel: "claude-opus-5.5",
    effectiveCanonMode: "FULL_LEGACY",
    requestBodyFingerprint: "2fdcfa40c78389c6e4f5847171a27de231877fffda9a5a0355361a2bc54c8f3f",
    finalWireFingerprint: "b594f0740fa027b44fa1346f396edb931e269bbebf3eb517982e035b320a3f11",
    maxTokensPresent: false,
  },
  {
    requestOrder: 5,
    fixtureId: "B_conflict_action_spatial",
    canonicalId: "deepseek-v4.1-flash",
    provider: "cheaperinference",
    wireModel: "deepseek-v4.1-flash",
    effectiveCanonMode: "LAYERED",
    requestBodyFingerprint: "b55af31957ea16fe994879d6bb407ca6351032ea176f44dee517e8a49b7b2dff",
    finalWireFingerprint: "4f1b48a8e75314b2ec7acc52318243e4ab72dd41929991a4b6a797e310adb25d",
    maxTokensPresent: false,
  },
  {
    requestOrder: 6,
    fixtureId: "B_conflict_action_spatial",
    canonicalId: "gemini-3.8-flash",
    provider: "openrouter",
    wireModel: "google/gemini-3.8-flash",
    effectiveCanonMode: "FULL_LEGACY",
    requestBodyFingerprint: "e75df878bab5c291e66bd7272c8fbc30a22a6ed2b19fe2e1fa943e7b62d1c9cd",
    finalWireFingerprint: "7a9ef77e07efee85e5871ef4673a6041909b174286e42903a0a7a35d38061f4c",
    maxTokensPresent: false,
  },
  {
    requestOrder: 7,
    fixtureId: "B_conflict_action_spatial",
    canonicalId: "gpt-6.1-sol",
    provider: "cheaperinference",
    wireModel: "gpt-6.1-sol",
    effectiveCanonMode: "FULL_LEGACY",
    requestBodyFingerprint: "9378bcdb0462adfdc42d22c15aeb555fc4b269a22a2af965347434b4655124f0",
    finalWireFingerprint: "fc0644a89d18e9cd19d2055328cb34a6b03010065bff6775ed0f59495321e13e",
    maxTokensPresent: false,
  },
  {
    requestOrder: 8,
    fixtureId: "B_conflict_action_spatial",
    canonicalId: "claude-opus-5.5",
    provider: "cheaperinference",
    wireModel: "claude-opus-5.5",
    effectiveCanonMode: "FULL_LEGACY",
    requestBodyFingerprint: "1719113d8000a06dcbf2fd6ce9d377f6734e5013d170a33ada40f3671fbeb963",
    finalWireFingerprint: "7effb290fd309a6f26f0606c80d773c8cd08f41075c4b33fcb68c3a4ee21a395",
    maxTokensPresent: false,
  },
  {
    requestOrder: 9,
    fixtureId: "C_continuity_progression",
    canonicalId: "deepseek-v4.1-flash",
    provider: "cheaperinference",
    wireModel: "deepseek-v4.1-flash",
    effectiveCanonMode: "LAYERED",
    requestBodyFingerprint: "7120205e28d91bf6b7fdc98d63a85842e616af87d378d1b99eda4fe90ab04ea5",
    finalWireFingerprint: "de9b2bae1c6e83632a6bc4d383b5b0df85670b5f90778b6ca9e0c4cdceecb130",
    maxTokensPresent: false,
  },
  {
    requestOrder: 10,
    fixtureId: "C_continuity_progression",
    canonicalId: "gemini-3.8-flash",
    provider: "openrouter",
    wireModel: "google/gemini-3.8-flash",
    effectiveCanonMode: "FULL_LEGACY",
    requestBodyFingerprint: "973b65d9e3d8332c9e0f43e1b2d5cd3168dd1e0751b5eb90a9ea78d6d74c5e7d",
    finalWireFingerprint: "5b151fd0c7841474cda70308dd386e1b8bb77ce998709ea136ce375da907422b",
    maxTokensPresent: false,
  },
  {
    requestOrder: 11,
    fixtureId: "C_continuity_progression",
    canonicalId: "gpt-6.1-sol",
    provider: "cheaperinference",
    wireModel: "gpt-6.1-sol",
    effectiveCanonMode: "FULL_LEGACY",
    requestBodyFingerprint: "5d285c925b08aed0e7dd79b2bd9b5706efe379550ab48767079c71a5e1c31ba8",
    finalWireFingerprint: "6e3414a6e84684f7e3a625a920bddab8933841cc4eab2f287276edb5e00f7cc3",
    maxTokensPresent: false,
  },
  {
    requestOrder: 12,
    fixtureId: "C_continuity_progression",
    canonicalId: "claude-opus-5.5",
    provider: "cheaperinference",
    wireModel: "claude-opus-5.5",
    effectiveCanonMode: "FULL_LEGACY",
    requestBodyFingerprint: "4faec6bac164a1be4b676356c88c84a4b55fc80103c80b7a2a247966b656b193",
    finalWireFingerprint: "09c7b356a2b4d0b4e1f28a05168550e294f418ffb5fafaebede6314aa3898adb",
    maxTokensPresent: false,
  },
] as const;

/**
 * #1587 intentionally rewrote only the `[SCENE PACING]` block of the quiet
 * A and C scenes (ESCALATE/OPERATION -> MICRO_MOTION/DYAD). The historical
 * #1466 constants above stay untouched; this is the verified successor
 * baseline. B calls are inherited from #1466 on purpose so any B change is
 * still drift. `manifestFingerprint` is the A_relationship_emotion-scoped
 * manifest (the 12-call unscoped precall manifest has a different fingerprint).
 */
export const PUBLISHED_1587_PRODUCTION_SHA =
  "41808ea8ba2d952838bac27c553910d68e8be43d" as const;
export const PUBLISHED_1587_A_SCOPE_MANIFEST_FINGERPRINT =
  "ec7688de27127d114210eb262aef54a76ca653a20738b3d8293daa652596db06" as const;

const PUBLISHED_1587_PACING_CALL_FINGERPRINTS: Readonly<
  Record<number, { requestBodyFingerprint: string; finalWireFingerprint: string }>
> = {
  1: {
    requestBodyFingerprint: "c4535f138ef2fac3a81c90444d8d838fa14e512e317dabf539d11e05f10cb924",
    finalWireFingerprint: "e4b4e276aa6802f98ed39dcf9a23fd44fadad1c79933225f001df6afed57c46c",
  },
  2: {
    requestBodyFingerprint: "2bb24a1fb60bc378c65450f876f7b260fceee510ada2e1b0c7314229f4fec7ef",
    finalWireFingerprint: "e2b407a47fc5bf9d2632bad6a90b7fd660be2aba245b2a7262780922700a5c27",
  },
  3: {
    requestBodyFingerprint: "a321ef6089c8cf1a2e1dabf36c51fc7404daa404c87e77db268686679dfae5a6",
    finalWireFingerprint: "ac3eaebda257175a0f5b47b2e331b703a5705134647db31d7b9e59ed768158e8",
  },
  4: {
    requestBodyFingerprint: "d212cf2966369132aa04ffae01a9d40d39caaaed2169e9b06646be5407eb2252",
    finalWireFingerprint: "2720e9cc3354a53828bf7a0bb8664bfa0140004886762f303021aafbe2af8d4d",
  },
  9: {
    requestBodyFingerprint: "6819bd94858f253c135513e2213710d052d5a7983c7d69c6326259132bfccb46",
    finalWireFingerprint: "2f32db5f47bfcbfb092035d214cfc59c3c7e34d4d048ca930bf8fb199d456666",
  },
  10: {
    requestBodyFingerprint: "b7b0c7ae2b4dec7e4b986d9e9c82e8be069806c8bb7405e10c41af471597c180",
    finalWireFingerprint: "b8773c8f5a33d4309aac3f6b10038bfd5bf751f4e56c31a2952c5474325f697a",
  },
  11: {
    requestBodyFingerprint: "53cf28991779cafee3ccb5db2b6e35acffd4f386e7e4a2b6af4f8b2afe3ab12f",
    finalWireFingerprint: "50498aab67a34962eee794c056f7e425cf22d77337dab39feb2ebc4289a7d11f",
  },
  12: {
    requestBodyFingerprint: "ece7bd0cbfe42f0f4ddeb10ef9a217b4074d12e42d7630d84bdcd018264226b6",
    finalWireFingerprint: "a09b4c5b64ab05111040e44f70613723df115a824ae65df085561e927e0f9774",
  },
};

export type Published1466ComparableCall = {
  requestOrder: number;
  fixtureId: string;
  canonicalId: string;
  provider: string;
  wireModel: string;
  effectiveCanonMode: string;
  requestBodyFingerprint: string;
  finalWireFingerprint: string;
  maxTokensPresent: boolean;
};

export type Published1466ComparableSeal = {
  mainSha?: string;
  productionDeploySha: string;
  identityHash: string;
  identityHashes: PaidRunnerIdentityHashes;
  manifestFingerprint: string;
  executionScope?: PaidRunnerExecutionScope;
  calls: readonly Published1466ComparableCall[];
};

export type Published1466CompareVerdict =
  | "MATCH"
  | "EXPECTED_DEPLOY_SHA_ROTATION"
  | "UNEXPECTED_FINGERPRINT_ROTATION"
  | "BODY_DRIFT";

export type Published1466CompareResult = {
  identityMatch: boolean;
  requestBodyMatch: boolean;
  finalWireMatch: boolean;
  providerCanonUncappedMatch: boolean;
  bodyDrift: boolean;
  manifestFingerprintMatch: boolean;
  deployShaChanged: boolean;
  verdict: Published1466CompareVerdict;
};

export function published1466ComparableSeal(): Published1466ComparableSeal {
  return {
    mainSha: PUBLISHED_1466_PRODUCTION_SHA,
    productionDeploySha: PUBLISHED_1466_PRODUCTION_SHA,
    identityHash: PUBLISHED_1466_IDENTITY_HASH,
    identityHashes: { ...PUBLISHED_1466_IDENTITY_HASHES },
    manifestFingerprint: PUBLISHED_1466_MANIFEST_FINGERPRINT,
    calls: PUBLISHED_1466_CALLS.map((call) => ({ ...call })),
  };
}

export function published1587ComparableSeal(): Published1466ComparableSeal {
  return {
    mainSha: PUBLISHED_1587_PRODUCTION_SHA,
    productionDeploySha: PUBLISHED_1587_PRODUCTION_SHA,
    identityHash: PUBLISHED_1466_IDENTITY_HASH,
    identityHashes: { ...PUBLISHED_1466_IDENTITY_HASHES },
    manifestFingerprint: PUBLISHED_1587_A_SCOPE_MANIFEST_FINGERPRINT,
    calls: PUBLISHED_1466_CALLS.map((call) => ({
      ...call,
      ...PUBLISHED_1587_PACING_CALL_FINGERPRINTS[call.requestOrder],
    })),
  };
}

export function paidRunnerPublicSealFromManifest(
  manifest: PaidRunnerPublicManifest
): Published1466ComparableSeal {
  return {
    mainSha: manifest.mainSha,
    productionDeploySha: manifest.productionDeploySha,
    identityHash: manifest.identityHash,
    identityHashes: { ...manifest.identityHashes },
    manifestFingerprint: manifest.manifestFingerprint,
    ...(manifest.executionScope ? { executionScope: manifest.executionScope } : {}),
    calls: manifest.calls.map((call) => ({
      requestOrder: call.requestOrder,
      fixtureId: call.fixtureId,
      canonicalId: call.canonicalId,
      provider: call.provider,
      wireModel: call.wireModel,
      effectiveCanonMode: call.effectiveCanonMode,
      requestBodyFingerprint: call.requestBodyFingerprint,
      finalWireFingerprint: call.finalWireFingerprint,
      maxTokensPresent: call.maxTokensPresent,
    })),
  };
}

export function comparePaidRunnerPublicSeal(
  current: Published1466ComparableSeal,
  baseline: Published1466ComparableSeal
): Published1466CompareResult {
  const identityMatch =
    current.identityHash === baseline.identityHash &&
    current.identityHashes.greetingSha256 === baseline.identityHashes.greetingSha256 &&
    current.identityHashes.systemPromptSha256 === baseline.identityHashes.systemPromptSha256 &&
    current.identityHashes.worldSha256 === baseline.identityHashes.worldSha256 &&
    current.identityHashes.settingChunksSha256 === baseline.identityHashes.settingChunksSha256 &&
    current.identityHashes.personaPublicSha256 === baseline.identityHashes.personaPublicSha256;

  let requestBodyMatch = current.calls.length === baseline.calls.length;
  let finalWireMatch = requestBodyMatch;
  let providerCanonUncappedMatch = requestBodyMatch;
  for (let index = 0; index < baseline.calls.length; index += 1) {
    const expected = baseline.calls[index];
    const actual = current.calls[index];
    if (!expected || !actual) {
      requestBodyMatch = false;
      finalWireMatch = false;
      providerCanonUncappedMatch = false;
      break;
    }
    if (
      actual.requestOrder !== expected.requestOrder ||
      actual.fixtureId !== expected.fixtureId ||
      actual.canonicalId !== expected.canonicalId ||
      actual.requestBodyFingerprint !== expected.requestBodyFingerprint
    ) {
      requestBodyMatch = false;
    }
    if (actual.finalWireFingerprint !== expected.finalWireFingerprint) {
      finalWireMatch = false;
    }
    if (
      actual.provider !== expected.provider ||
      actual.wireModel !== expected.wireModel ||
      actual.effectiveCanonMode !== expected.effectiveCanonMode ||
      actual.maxTokensPresent !== false
    ) {
      providerCanonUncappedMatch = false;
    }
  }

  const bodyDrift = !identityMatch || !requestBodyMatch || !finalWireMatch || !providerCanonUncappedMatch;
  const manifestFingerprintMatch = current.manifestFingerprint === baseline.manifestFingerprint;
  const deployShaChanged =
    current.productionDeploySha !== baseline.productionDeploySha ||
    (current.mainSha != null && baseline.mainSha != null && current.mainSha !== baseline.mainSha);

  let verdict: Published1466CompareVerdict;
  if (bodyDrift) {
    verdict = "BODY_DRIFT";
  } else if (manifestFingerprintMatch) {
    verdict = "MATCH";
  } else if (deployShaChanged) {
    verdict = "EXPECTED_DEPLOY_SHA_ROTATION";
  } else {
    verdict = "UNEXPECTED_FINGERPRINT_ROTATION";
  }

  return {
    identityMatch,
    requestBodyMatch,
    finalWireMatch,
    providerCanonUncappedMatch,
    bodyDrift,
    manifestFingerprintMatch,
    deployShaChanged,
    verdict,
  };
}

export function compareToPublished1466Seal(
  current: Published1466ComparableSeal
): Published1466CompareResult {
  return comparePaidRunnerPublicSeal(current, published1466ComparableSeal());
}

export function compareToPublishedPaidRunnerSeals(
  current: Published1466ComparableSeal
): Published1466CompareResult {
  const vs1466 = compareToPublished1466Seal(current);
  if (vs1466.verdict !== "BODY_DRIFT") return vs1466;
  if (current.executionScope !== PAID_RUNNER_A_RELATIONSHIP_EMOTION_SCOPE) return vs1466;
  return comparePaidRunnerPublicSeal(current, published1587ComparableSeal());
}
