import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  VNEXT_CLEAN_SMOKE_DISPLAY_NAMES,
  VNEXT_CLEAN_SMOKE_MAX_TOKENS,
  VNEXT_CLEAN_SMOKE_SPEC,
  assertNoPrcSyntheticIdentityInPrompt,
  buildVNextSmokeInternalMarker,
  isVNextSmokeMaxTokensEnvEnabled,
  resolveVNextCleanSmokeDisplayName,
  resolveVNextSmokeMaxTokensOverride,
} from "./vnextCleanSmokeFixtures";

describe("vnextCleanSmokeFixtures — identity", () => {
  it("uses Korean display names for characters.name surfaces", () => {
    assert.equal(resolveVNextCleanSmokeDisplayName("quiet"), "이준서");
    assert.equal(resolveVNextCleanSmokeDisplayName("tactical"), "에녹");
    assert.equal(resolveVNextCleanSmokeDisplayName("locked"), "카일");
    assert.deepEqual(VNEXT_CLEAN_SMOKE_DISPLAY_NAMES, {
      quiet: "이준서",
      tactical: "에녹",
      locked: "카일",
    });
  });

  it("keeps PRC markers only in internal metadata ids", () => {
    assert.match(buildVNextSmokeInternalMarker("quiet", "prc-canary-abcdef12"), /^PRC-QUIET-/);
    assert.match(buildVNextSmokeInternalMarker("tactical", "prc-canary-abcdef12"), /^PRC-TAC-/);
    assert.match(buildVNextSmokeInternalMarker("locked", "prc-canary-abcdef12"), /^PRC-LOCKED-/);
  });

  it("assertNoPrcSyntheticIdentityInPrompt rejects PRC-* on identity surfaces", () => {
    const bad = assertNoPrcSyntheticIdentityInPrompt({
      characterName: "PRC-QUIET-97355200",
      charName: "에녹",
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.ok(bad.hits.some((h) => h.startsWith("characterName:")));

    const badTac = assertNoPrcSyntheticIdentityInPrompt({
      charName: "PRC-TAC-97355200",
      assembledSystemText: "You are 에녹.",
    });
    assert.equal(badTac.ok, false);

    const okClean = assertNoPrcSyntheticIdentityInPrompt({
      characterName: "이준서",
      charName: "에녹",
      systemPromptIdentity: "[이름]\n카일",
      assembledSystemText: "캐릭터 이름: 이준서 / 에녹 / 카일",
    });
    assert.equal(okClean.ok, true);
  });
});

describe("vnextCleanSmokeFixtures — max_tokens override", () => {
  it("is off by default (env unset / disabled)", () => {
    assert.equal(isVNextSmokeMaxTokensEnvEnabled(undefined), false);
    assert.equal(isVNextSmokeMaxTokensEnvEnabled(""), false);
    assert.equal(isVNextSmokeMaxTokensEnvEnabled("0"), false);
    assert.equal(
      resolveVNextSmokeMaxTokensOverride({ envEnabled: false, smokeMaxTokens: 4096 }),
      undefined
    );
  });

  it("accepts 4096 when env enabled and value in [1024,8192]", () => {
    assert.equal(isVNextSmokeMaxTokensEnvEnabled("1"), true);
    assert.equal(
      resolveVNextSmokeMaxTokensOverride({
        envEnabled: true,
        smokeMaxTokens: VNEXT_CLEAN_SMOKE_MAX_TOKENS,
      }),
      4096
    );
    assert.equal(
      resolveVNextSmokeMaxTokensOverride({ envEnabled: true, smokeMaxTokens: 1024 }),
      1024
    );
    assert.equal(
      resolveVNextSmokeMaxTokensOverride({ envEnabled: true, smokeMaxTokens: 8192 }),
      8192
    );
  });

  it("rejects out-of-range or non-finite values", () => {
    assert.equal(
      resolveVNextSmokeMaxTokensOverride({ envEnabled: true, smokeMaxTokens: 1023 }),
      undefined
    );
    assert.equal(
      resolveVNextSmokeMaxTokensOverride({ envEnabled: true, smokeMaxTokens: 8193 }),
      undefined
    );
    assert.equal(
      resolveVNextSmokeMaxTokensOverride({ envEnabled: true, smokeMaxTokens: "nope" }),
      undefined
    );
    assert.equal(
      resolveVNextSmokeMaxTokensOverride({ envEnabled: true, smokeMaxTokens: NaN }),
      undefined
    );
  });
});

describe("vnextCleanSmokeFixtures — future clean-smoke spec", () => {
  it("is prepared but must not execute", () => {
    assert.equal(VNEXT_CLEAN_SMOKE_SPEC.prepared, true);
    assert.equal(VNEXT_CLEAN_SMOKE_SPEC.execute, false);
    assert.equal(VNEXT_CLEAN_SMOKE_SPEC.modelCallsExact, 4);
    assert.equal(VNEXT_CLEAN_SMOKE_SPEC.calls.length, 4);
    assert.equal(VNEXT_CLEAN_SMOKE_SPEC.calls[0]?.displayName, "이준서");
    assert.equal(VNEXT_CLEAN_SMOKE_SPEC.calls[1]?.displayName, "에녹");
    assert.equal(VNEXT_CLEAN_SMOKE_SPEC.preferredMaxTokens, 4096);
  });
});
