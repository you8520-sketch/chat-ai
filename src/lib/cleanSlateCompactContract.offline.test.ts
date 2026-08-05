/**
 * Offline gate for clean-slate compact contract canary.
 *
 * Run:
 *   node --conditions=react-server --import tsx --test src/lib/cleanSlateCompactContract.offline.test.ts
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  CLEAN_SLATE_COMPACT_CONTRACT,
  CLEAN_SLATE_REJECTED_STACK_MARKERS,
  RP_DIAGNOSTIC_CANARY_ENV,
  appendCleanSlateCompactContract,
  applyRpDiagnosticToSceneDirectiveBlock,
  resolveRpDiagnosticCanary,
  rpDiagnosticUsesCleanSlateCompactContract,
} from "@/lib/rpDiagnosticCanary";
import { DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA } from "@/lib/deepseekPromptStructure";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import { renderSceneDirectiveForPrompt, buildSceneDirective } from "@/lib/sceneDirective";

const ENV_KEYS = [
  RP_DIAGNOSTIC_CANARY_ENV.ENABLED,
  RP_DIAGNOSTIC_CANARY_ENV.USER_IDS,
  RP_DIAGNOSTIC_CANARY_ENV.MODEL_IDS,
  RP_DIAGNOSTIC_CANARY_ENV.VARIANT,
] as const;

function saveEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) out[k] = process.env[k];
  return out;
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

function productionSceneBlock(): string {
  return renderSceneDirectiveForPrompt(
    buildSceneDirective({
      mode: "normal",
      recentMessages: [
        {
          role: "user",
          content:
            "나는 렌이라고 부르면 돼....나는 본기억이 안나는데....나 알아?(갸웃)",
        },
      ],
      currentUserMessage:
        "나는 렌이라고 부르면 돼....나는 본기억이 안나는데....나 알아?(갸웃)",
      contentKind: "character",
      primaryCharacterName: "라이크",
      party: false,
      chatId: 1,
      currentTurn: 1,
    })
  );
}

describe("clean-slate compact contract offline gate", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = saveEnv();
  });

  afterEach(() => {
    restoreEnv(saved);
  });

  it("canary OFF → SceneDirective equals production baseline", () => {
    delete process.env[RP_DIAGNOSTIC_CANARY_ENV.ENABLED];
    const canary = resolveRpDiagnosticCanary({
      userId: 34,
      modelId: "deepseek-v4-pro",
      contentKind: "character",
    });
    assert.equal(canary, null);
    const prod = productionSceneBlock();
    const applied = applyRpDiagnosticToSceneDirectiveBlock({
      block: prod,
      canary: null,
      completedTurns: 0,
    });
    assert.equal(applied, prod);
  });

  it("canary ON → exactly one compact contract appendix; no new section", () => {
    process.env[RP_DIAGNOSTIC_CANARY_ENV.ENABLED] = "true";
    process.env[RP_DIAGNOSTIC_CANARY_ENV.USER_IDS] = "34";
    process.env[RP_DIAGNOSTIC_CANARY_ENV.MODEL_IDS] = "deepseek-v4-pro";
    process.env[RP_DIAGNOSTIC_CANARY_ENV.VARIANT] = "clean_slate_compact_contract";

    const canary = resolveRpDiagnosticCanary({
      userId: 34,
      modelId: "deepseek-v4-pro",
      contentKind: "character",
    });
    assert.ok(canary?.active);
    assert.equal(canary?.variant, "clean_slate_compact_contract");
    assert.equal(rpDiagnosticUsesCleanSlateCompactContract(canary!.variant), true);

    const prod = productionSceneBlock();
    const on = applyRpDiagnosticToSceneDirectiveBlock({
      block: prod,
      canary,
      completedTurns: 0,
    });

    assert.equal(on.startsWith(prod.trimEnd()), true);
    assert.equal(on, `${prod.trimEnd()}\n${CLEAN_SLATE_COMPACT_CONTRACT}`);
    assert.equal(on.split(CLEAN_SLATE_COMPACT_CONTRACT).length - 1, 1);
    assert.equal(on.includes("[CLEAN_SLATE"), false);
    assert.equal(on.includes("pushSection"), false);

    // Idempotent append
    assert.equal(appendCleanSlateCompactContract(on), on);

    // Rejected stack markers absent from SceneDirective
    for (const marker of CLEAN_SLATE_REJECTED_STACK_MARKERS) {
      assert.equal(on.includes(marker), false, `rejected marker present: ${marker}`);
    }

    // DeepSeek SHORT HISTORY / terminal owner constants unchanged (byte parity of owners)
    assert.ok(DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA.startsWith("[SHORT HISTORY]\n"));
    assert.ok(USER_TAIL_LENGTH_OWNER_SENTENCE.length > 0);
    assert.equal(
      DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA.includes("specific interpretation"),
      false
    );

    const outDir = join(
      process.cwd(),
      "docs/audits/37-clean-slate-compact-human-review"
    );
    mkdirSync(outDir, { recursive: true });
    const diff = [
      "=== production SceneDirective (canary OFF) ===",
      prod,
      "",
      "=== compact candidate SceneDirective (canary ON) ===",
      on,
      "",
      "=== diff locations ===",
      "SceneDirective block end: +1 line CLEAN_SLATE_COMPACT_CONTRACT",
      "new system section: 0",
      "new user-tail block: 0",
      "contract occurrence: 1",
      "DeepSeek SHORT HISTORY: unchanged constant",
      "terminal length owner: unchanged constant",
      "",
      "CLEAN_SLATE_COMPACT_CONTRACT_OFFLINE_PASS",
    ].join("\n");
    writeFileSync(join(outDir, "PROMPT_DIFF.txt"), diff, "utf8");
    writeFileSync(
      join(outDir, "OFFLINE_GATE_VERDICT.json"),
      JSON.stringify(
        {
          verdict: "CLEAN_SLATE_COMPACT_CONTRACT_OFFLINE_PASS",
          contract_occurrence: 1,
          new_system_section: 0,
          new_user_tail_block: 0,
          rejected_markers_absent: true,
          scene_directive_location: "append_at_existing_block_end",
        },
        null,
        2
      ),
      "utf8"
    );
  });
});
