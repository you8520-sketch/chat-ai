import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { isLayeredCanonActive, resolveCanonInjectionPolicy } from "@/lib/canonInjectionPolicy";
import { compileCanonPlanV1 } from "@/lib/canonPlan/compiler";
import {
  CHARACTER_SECRET_AUDIT_RELATIVE_PATH,
  SECRET_AUDIT_CASES,
  buildCharacterSecretDeliveryEvidence,
  buildCharacterSecretDeliveryReport,
} from "@/lib/canonPlan/characterSecretDeliveryAudit";
import { buildContext } from "@/services/contextBuilder";
import type { CharacterChunk } from "@/types";

function settingChunk(content: string): CharacterChunk {
  return {
    id: "audit-1",
    characterId: "1",
    content,
    category: "identity",
    importance: "CRITICAL",
    tokenCount: 40,
    keywords: ["레온"],
  };
}

function assemblePrompt(opts: {
  modelId: string;
  systemPrompt: string;
  layered: boolean;
  regenerate?: boolean;
  isContinue?: boolean;
}) {
  const compiled = compileCanonPlanV1({
    creatorRawDescription: opts.systemPrompt,
    compilerDescription: opts.systemPrompt,
  });
  assert.equal(compiled.ok, true);
  if (!compiled.ok) throw new Error(compiled.error);
  const policy = opts.layered
    ? {
        ...resolveCanonInjectionPolicy(opts.modelId),
        actualCanonMode: "LAYERED" as const,
        canonMode: "LAYERED" as const,
        shadowOnly: false,
        injectionEnabled: true,
      }
    : resolveCanonInjectionPolicy(opts.modelId);
  return buildContext({
    charName: "레온",
    chunks: [settingChunk(opts.systemPrompt)],
    userNickname: "User",
    shortTermHistory: [],
    currentUserMessage: "장부를 보여 주세요",
    nsfw: false,
    longTermMemory: "",
    archiveMemory: "",
    modelId: opts.modelId,
    provider: "openrouter",
    canonInjectionPolicy: policy,
    canonPlan: compiled.plan,
    regenerate: opts.regenerate,
    isContinue: opts.isContinue,
  }).systemPrompt;
}

describe("issue 1321 character-secret delivery audit", () => {
  it("keeps the committed audit report identical to the live owner dump", () => {
    const generated = buildCharacterSecretDeliveryReport();
    const committed = fs.readFileSync(path.join(process.cwd(), CHARACTER_SECRET_AUDIT_RELATIVE_PATH), "utf8");
    assert.equal(committed, generated);
  });

  it("classifies freeform Korean secrets without inventing LOCKED_SECRET", () => {
    const evidence = buildCharacterSecretDeliveryEvidence();
    const known = evidence.cases.find((item) => item.key === "known_marked");
    const unlabeled = evidence.cases.find((item) => item.key === "unlabeled_freeform");
    const unknown = evidence.cases.find((item) => item.key === "unknown_marked");
    assert.ok(known?.compiled.ok && unlabeled?.compiled.ok && unknown?.compiled.ok);
    assert.ok(known.tokenRouting[0]?.inS2);
    assert.equal(unlabeled.tokenRouting[0]?.inS2, false);
    assert.ok(unlabeled.tokenRouting[0]?.chunkVisibilities.includes("PUBLIC"));
    assert.equal(unknown.tokenRouting[0]?.inS2, false);
    assert.ok(unknown.tokenRouting[0]?.chunkVisibilities.includes("CONDITIONAL"));
  });

  it("defaults every current Main RP model to FULL_LEGACY S2-off", () => {
    for (const modelId of MAIN_RP_MODEL_IDS) {
      const policy = resolveCanonInjectionPolicy(modelId);
      assert.equal(policy.actualCanonMode, "FULL_LEGACY", modelId);
      assert.equal(isLayeredCanonActive(policy), false, modelId);
    }
  });

  it("compares FULL_LEGACY vs LAYERED staged prompts for the marked secret", () => {
    const modelId = MAIN_RP_MODEL_IDS[0]!;
    const source = SECRET_AUDIT_CASES.known_marked.systemPrompt;
    const legacy = assemblePrompt({ modelId, systemPrompt: source, layered: false });
    const layered = assemblePrompt({ modelId, systemPrompt: source, layered: true });
    assert.match(legacy, /TOKEN_KNOWN_LEDGER/);
    assert.doesNotMatch(legacy, /PRIVATE CHARACTER SECRET — DO NOT DISCLOSE/);
    assert.match(layered, /TOKEN_KNOWN_LEDGER/);
    assert.match(layered, /PRIVATE CHARACTER SECRET — DO NOT DISCLOSE/);
  });

  it("does not put unlabeled freeform prose into the S2 concealment block", () => {
    const modelId = MAIN_RP_MODEL_IDS[0]!;
    const source = SECRET_AUDIT_CASES.unlabeled_freeform.systemPrompt;
    const legacy = assemblePrompt({ modelId, systemPrompt: source, layered: false });
    const layered = assemblePrompt({ modelId, systemPrompt: source, layered: true });
    assert.match(legacy, /TOKEN_UNLABELED_FREEFORM/);
    assert.doesNotMatch(legacy, /PRIVATE CHARACTER SECRET — DO NOT DISCLOSE/);
    assert.doesNotMatch(layered, /PRIVATE CHARACTER SECRET — DO NOT DISCLOSE/);
    assert.doesNotMatch(layered, /TOKEN_UNLABELED_FREEFORM/);
  });

  it("keeps regen and continue on the same secret owners", () => {
    const modelId = MAIN_RP_MODEL_IDS[0]!;
    const source = SECRET_AUDIT_CASES.known_marked.systemPrompt;
    const normal = assemblePrompt({ modelId, systemPrompt: source, layered: true });
    const regen = assemblePrompt({ modelId, systemPrompt: source, layered: true, regenerate: true });
    const cont = assemblePrompt({ modelId, systemPrompt: source, layered: true, isContinue: true });
    assert.match(normal, /TOKEN_KNOWN_LEDGER/);
    assert.match(regen, /TOKEN_KNOWN_LEDGER/);
    assert.match(cont, /TOKEN_KNOWN_LEDGER/);
    assert.match(regen, /PRIVATE CHARACTER SECRET — DO NOT DISCLOSE/);
    assert.match(cont, /PRIVATE CHARACTER SECRET — DO NOT DISCLOSE/);
  });

  it("omits an oversized LOCKED_SECRET body from S2 instead of leaking it to CORE", () => {
    const evidence = buildCharacterSecretDeliveryEvidence();
    const longCase = evidence.cases.find((item) => item.key === "long_marked");
    assert.ok(longCase?.compiled.ok);
    assert.ok((longCase.compiled.s2OmittedCount ?? 0) >= 1);
    assert.equal(longCase.tokenRouting[0]?.inS2, false);
    assert.equal(longCase.tokenRouting[0]?.inCore, false);
  });
});
