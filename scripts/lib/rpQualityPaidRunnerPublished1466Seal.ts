/**
 * Public #1466 preapproval fingerprints (plus the #1587, #1612 / #1602+#1595,
 * and #1616 successor baselines below) only. No request bodies, no secrets.
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

/**
 * Historical #1612 baseline (#1602+#1595). Two intentional, separately merged
 * input changes moved every call after #1587 (identity, provider, wire model,
 * canon mode and the absent `max_tokens` were all unchanged):
 * - #1602 removed the false cold-start Scene Momentum block from the DeepSeek
 *   user message (orders 1, 5, 9).
 * - #1595 raised the RP setting source cap so the previously cut tail of the
 *   character's dialogue examples and SPEECH CONSISTENCY block reaches the
 *   Gemini / GPT / Opus system prompt (orders 2-4, 6-8, 10-12).
 * Kept as evidence. The live dispatch gate no longer compares against this seal.
 * `manifestFingerprint` is the A_relationship_emotion-scoped manifest.
 */
export const PUBLISHED_1602_1595_PRODUCTION_SHA =
  "b7159ec6fe2aeea78c75d1bdb5256adac32d93eb" as const;
export const PUBLISHED_1612_PRODUCTION_SHA = PUBLISHED_1602_1595_PRODUCTION_SHA;
export const PUBLISHED_1602_1595_A_SCOPE_MANIFEST_FINGERPRINT =
  "5d8546b748763c3da9acb8d4b596b22097f2f09c2ee0340b5ee609f387eafd6e" as const;
export const PUBLISHED_1612_A_SCOPE_MANIFEST_FINGERPRINT =
  PUBLISHED_1602_1595_A_SCOPE_MANIFEST_FINGERPRINT;

const PUBLISHED_1602_1595_CALL_FINGERPRINTS: Readonly<
  Record<number, { requestBodyFingerprint: string; finalWireFingerprint: string }>
> = {
  1: {
    requestBodyFingerprint: "12afebe9eb9ca1040ceefdfa5e05e4c544b2b9d75cbf136a7857f140651395ed",
    finalWireFingerprint: "b6f940eb15a3829e2b4cf87e20f505ec5bfa4280c6ab3f41403b845483196a64",
  },
  2: {
    requestBodyFingerprint: "689df88f5677221748ca322a5b32158326a7e993e5a698947021306fcc950632",
    finalWireFingerprint: "68e8e7702572ceb7390fbfbcbabc6eb2f5db8a1e548d4b542abbe11ec494151a",
  },
  3: {
    requestBodyFingerprint: "3ab97dc5102d0518d63b7719f5475a8520349a0c00d313b6e57bb5bff6491dde",
    finalWireFingerprint: "5184d8b32811ed4146259ee687a58a0e5e45b2a15ad557d79203d0a269a7cba7",
  },
  4: {
    requestBodyFingerprint: "962e2d5213730f6ecbd14033a0bd4ba96ab677ef98d8e0f0af83213aab98e67a",
    finalWireFingerprint: "fedb433182517415041001037c87dd98e54f715afce102be22eae7649d679a00",
  },
  5: {
    requestBodyFingerprint: "d862e6e6bcffbe464475f4f34498d790aaebf234d02dee897375e029902885de",
    finalWireFingerprint: "69a48e8dea9e463dbb6b05238978b3bdb184ef9fc2d783d91e44bb7539fa1615",
  },
  6: {
    requestBodyFingerprint: "78416b7e1f4422e14042f823723eb8bc9390147778186835210ce0c3d2499274",
    finalWireFingerprint: "d0656ed0c7f5844f432836d6604522ede39f807cb274877a6bdbe6b837b91413",
  },
  7: {
    requestBodyFingerprint: "503e29430cab982f06c2aef06489b887ccc50b3cc40ca80f37cb63b72d0a46a6",
    finalWireFingerprint: "247425e6e20050956d045d4f1b34eec4dbd3f7df781e366ed9c912d0e9dce1ad",
  },
  8: {
    requestBodyFingerprint: "617f7f6507b1301117aa435a9be12dae82978d5c0e9d751d2c4e1f067489ffa5",
    finalWireFingerprint: "71186b8312af50a40791a5c47965e711569974e07d4338aa36daf4d2a754fa45",
  },
  9: {
    requestBodyFingerprint: "1eb718368070b3f6edd28e64168cf044e0afb0fa01982f0fc0e0dc81cb4c7d00",
    finalWireFingerprint: "aecba24718190be5ec8df373f3c432952d0b894ccc5d85595933e361ad3b65a8",
  },
  10: {
    requestBodyFingerprint: "529b023dfffed987e5fa54ec274c148b71b58cb387633e4f6adf6ffca2037fb8",
    finalWireFingerprint: "d94bb5d57849d47e43bfc539572e8e3c8634f408e7ccb4964ade5c9d945057eb",
  },
  11: {
    requestBodyFingerprint: "a263dd1c71f0b148bbe6672aca96636beef92186a8305c68851b7fb48a65b3e8",
    finalWireFingerprint: "dbd1f34e54707b7dd1390643d769b7432407bfc4024d5406c8cb4e43446e5edd",
  },
  12: {
    requestBodyFingerprint: "5430cf48b9ab6dffbb37d935482ffeb80674b78ef7c92526d1a6f29d7c9fad7d",
    finalWireFingerprint: "119edb8991129b64a631864d5db8389689d2bbd1c140d9ae1b2c0dc5133efc78",
  },
};

/**
 * Live canonical baseline. Two approved deltas after #1612, pinned from the
 * deployed read-only reseal at this SHA (Railway SUCCESS + container):
 * - #1616 replaced only the DeepSeek V4.1 Flash `[이번 응답 대화]` axis line
 *   (orders 1, 5, 9 body/wire). Gemini / Sol / Opus stay on the #1612 pins.
 * - CASE B identity: `characters.setting_chunks` now equals the post-#1595
 *   fresh parse (`5bc7fcea…`). Creator source fields are unchanged; the paid
 *   runner already assembled from that fresh parse, so the 9 non-DeepSeek
 *   fingerprints do not move.
 * #1466 / #1587 / #1612 stay as historical evidence; the live dispatch gate
 * compares against this seal only. `manifestFingerprint` is A-scope.
 */
export const PUBLISHED_1616_PRODUCTION_SHA =
  "ac67801c5a3c0c2e25a8e5ae69dc68ba5a60add2" as const;
export const PUBLISHED_1616_IDENTITY_HASH =
  "9b89bf89c2f13130346de56eb150370b0930b44b3771bcf366edd8a6153cf53b" as const;
export const PUBLISHED_1616_A_SCOPE_MANIFEST_FINGERPRINT =
  "598a9b24561f77d560347ff1fc147fe4a48a26d3c7cb448198a84364b36d3b60" as const;

export const PUBLISHED_1616_IDENTITY_HASHES: PaidRunnerIdentityHashes = {
  ...PUBLISHED_1466_IDENTITY_HASHES,
  settingChunksSha256: "5bc7fcea4a29129190a89622414c60c849de7b1a4e48b70d0abcf31fd906e2a3",
};

const PUBLISHED_1616_CALL_FINGERPRINTS: Readonly<
  Record<number, { requestBodyFingerprint: string; finalWireFingerprint: string }>
> = {
  ...PUBLISHED_1602_1595_CALL_FINGERPRINTS,
  1: {
    requestBodyFingerprint: "31c28b26c28aa1231eb58c5d48e0b6cce3aff431aa11465c6eceb2b349d28652",
    finalWireFingerprint: "2ce069568468ab34b4b336d3ccb2d180bf3e4c34a8bae5d2e7db27b7ac71e8ae",
  },
  5: {
    requestBodyFingerprint: "766aa40b8ce0922968ce9266d46501d1a416eaf37988eb937640848d0cd28e9b",
    finalWireFingerprint: "9d1aee8f5764e065c605e32f81764c4dc335f0d7323bdac90228979a0f24a997",
  },
  9: {
    requestBodyFingerprint: "409f700cbb24a527f828c7a6158911c5176dcb89ecfeb734a1eceea615626878",
    finalWireFingerprint: "ec88aa8c62cf1213b50ca8b2358a708aaf3fb149c320d0a720b47faaf7e82be4",
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

/** Historical #1612 / #1602+#1595 seal. Not the live gate. */
export function published1612ComparableSeal(): Published1466ComparableSeal {
  return {
    mainSha: PUBLISHED_1602_1595_PRODUCTION_SHA,
    productionDeploySha: PUBLISHED_1602_1595_PRODUCTION_SHA,
    identityHash: PUBLISHED_1466_IDENTITY_HASH,
    identityHashes: { ...PUBLISHED_1466_IDENTITY_HASHES },
    manifestFingerprint: PUBLISHED_1602_1595_A_SCOPE_MANIFEST_FINGERPRINT,
    calls: PUBLISHED_1466_CALLS.map((call) => ({
      ...call,
      ...PUBLISHED_1602_1595_CALL_FINGERPRINTS[call.requestOrder],
    })),
  };
}

export function publishedCanonicalComparableSeal(): Published1466ComparableSeal {
  return {
    mainSha: PUBLISHED_1616_PRODUCTION_SHA,
    productionDeploySha: PUBLISHED_1616_PRODUCTION_SHA,
    identityHash: PUBLISHED_1616_IDENTITY_HASH,
    identityHashes: { ...PUBLISHED_1616_IDENTITY_HASHES },
    manifestFingerprint: PUBLISHED_1616_A_SCOPE_MANIFEST_FINGERPRINT,
    calls: PUBLISHED_1466_CALLS.map((call) => ({
      ...call,
      ...PUBLISHED_1616_CALL_FINGERPRINTS[call.requestOrder],
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

/** Historical #1466 -> #1587 chain, kept for evidence tests. Not the live gate. */
export function compareToPublishedPaidRunnerSeals(
  current: Published1466ComparableSeal
): Published1466CompareResult {
  const vs1466 = compareToPublished1466Seal(current);
  if (vs1466.verdict !== "BODY_DRIFT") return vs1466;
  if (current.executionScope !== PAID_RUNNER_A_RELATIONSHIP_EMOTION_SCOPE) return vs1466;
  return comparePaidRunnerPublicSeal(current, published1587ComparableSeal());
}

/** The single live approval baseline: the latest canonical seal only. */
export function compareToCanonicalPaidRunnerSeal(
  current: Published1466ComparableSeal
): Published1466CompareResult {
  return comparePaidRunnerPublicSeal(current, publishedCanonicalComparableSeal());
}
